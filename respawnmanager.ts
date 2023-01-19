
import { ZoneClient2016 as Client } from "h1z1-server/out/servers/ZoneServer2016/classes/zoneclient";
import { ZoneServer2016 } from "h1z1-server/out/servers/ZoneServer2016/zoneserver";
import { SpawnLocation } from "h1z1-server/out/types/zoneserver";
import { randomIntFromInterval } from "h1z1-server/out/utils/utils";
const _defaultSpawns: Spawns = require("../data/defaultspawns.json");

function log(log: string) {
  console.log("[RespawnManager] " + log);
}

type Spawns = {[name: string]: Array<SpawnLocation>};
export class RespawnManager {
  _server: ZoneServer2016;
  _spawns: Spawns = {};
  lastSpawnRefresh = Date.now();
  spawnRefreshTimer = 900000; // 15 minutes
  lastMOTD = 0;
  MOTDTimer = 300000; // 5 minutes
  currentSpawn: string = "";
  constructor(server: ZoneServer2016) {
    this._server = server;
    server._spawnLocations = [];
    //#region BIG HOOKS
    this._server.hook("OnWorldRoutine", () => {
      if (this.lastSpawnRefresh + this.spawnRefreshTimer <= Date.now()) {
        this.updateSpawns()
        this.lastSpawnRefresh = Date.now();
        if (this.lastMOTD + this.MOTDTimer <= Date.now()) {
          this._server.sendAlertToAll(`Current spawn: ${this.currentSpawn}`);
          this.lastMOTD = Date.now();
        }
      }
    })
    this._server.hook("OnClientFinishedLoading", (client: Client) => {
      if(client.firstLoading) {
        this._server.sendData(client, "Command.AddWorldCommand", {
          command: "add",
        });
      }
    });
    this._server.hook("OnClientExecuteCommand", (client: Client, commandHash: number, args: string) => {
      if(this.executeSpawnAddCommand(client, commandHash, args)) return false;
    });
    //#endregion
  }

  async init() {
    let dbSpawns = await this._server._db?.collection('spawns').find().toArray();
    if(!dbSpawns || dbSpawns.length == 0) {
      await this._server._db?.createCollection("spawns");
      await this._server._db?.collection("spawns").insertMany(Object.keys(_defaultSpawns).map((spawnName)=> {
        return {
          spawnName: spawnName,
          spawns: _defaultSpawns[spawnName]
        }
      }));
      dbSpawns = await this._server._db?.collection("spawns").find().toArray();
      log("Default spawn points successfully written to database");
    }
    dbSpawns?.forEach(spawn => {
      this._spawns[spawn.spawnName] = spawn.spawns.map((spawn: any)=> {
        return {
          ...spawn,
          position: new Float32Array(Object.values(spawn.position)),
          rotation: new Float32Array(Object.values(spawn.rotation))
        }
      });
    });
    log("Custom spawn points successfully loaded from database");
    this.updateSpawns()
    log("Initialized!")
  }

  updateSpawns() {
    const spawnKeys = Object.keys(this._spawns)
    const spawnLocationIdx = randomIntFromInterval(0, spawnKeys.length-1);
    const spawnLocation = Object.values(this._spawns)[spawnLocationIdx];
    this.currentSpawn = spawnKeys[spawnLocationIdx]
    log(`Current spawn locations: ${this.currentSpawn}`);
    this._server.sendAlertToAll(`New spawn location: ${this.currentSpawn}!`);
    let count = 5;
    const timeout = setTimeout(()=> {
      this._server.sendAlertToAll(`New spawn location: ${this.currentSpawn}!`);
      if(--count) timeout.refresh();
    }, 1000)
    this._server._spawnLocations = spawnLocation;
  }

  executeSpawnAddCommand(client: Client, commandHash: number, _args: string): boolean {
    const args: string[] = _args.split(" "),
      spawnName = args[0];
    if(client.isAdmin && commandHash == 337761972) { // /add
      if(!spawnName) {
        this._server.sendChatText(client, "Missing spawn name, correct usage `/add <spawnname>`");
        return true;
      }
      const spawn = {
          id: 0,
          name: "0",
          position: client.character.state.position,
          rotation: client.character.state.lookAt,
      };
      
      const collection = this._server._db?.collection("spawns");
      collection?.findOne({
        spawnName: spawnName,
      }).then((spawnArray)=> {
        if(!spawnArray) {
          collection.insertOne({
            spawnName: spawnName,
            spawns: [spawn]
          }).then(()=>{this._server.sendChatText(client, `Successfully added spawnlocation to new group '${spawnName}'`)})
        }
        else {
          if(!spawnArray) return true;
          collection.updateOne(
            { spawnName: spawnName }, 
            {
              $set: {
                spawns: [
                  ...spawnArray.spawns,
                  spawn
                ]
              },
            }
          ).then(()=>{this._server.sendChatText(client, `Successfully added spawnlocation to '${spawnName}'`)})
        }
      })
      return true;
    }
    return false;
  }
}
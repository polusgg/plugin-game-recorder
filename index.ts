import { BasePlugin, PluginMetadata } from "@nodepolus/framework/src/api/plugin";
import { MessageWriter } from "@nodepolus/framework/src/util/hazelMessage";
import { Connection } from "@nodepolus/framework/src/protocol/connection";
import { LobbyInstance } from "@nodepolus/framework/src/api/lobby";
import { RootPacketType } from "@nodepolus/framework/src/types/enums";

const pluginMetadata: PluginMetadata = {
  name: "Polus.gg Game Recorder",
  version: [1, 0, 0],
  authors: [
    {
      name: "Polus.gg",
      email: "contact@polus.gg",
      website: "https://polus.gg",
    },
  ],
  description: "NodePolus plugin for recording games. Used in the replay system, and in the leaderboard system",
  website: "https://polus.gg",
};

export default class extends BasePlugin {
  constructor() {
    super(pluginMetadata);

    const connectionToBufferMap = new Map < Connection, { type: RootPacketType, contents: Buffer, direction: "in" | "out" }[]>();
    const disconnectedPlayerLobbyMap = new Map<LobbyInstance, Connection[]>();

    this.server.on("server.packet.in", event => {
      const res = connectionToBufferMap.get(event.getConnection());
      const writer = new MessageWriter();
      event.getPacket().serialize(writer);

      if (res) {
        res.push({ type: event.getPacket().getType(), contents: writer.getBuffer(), direction: "in" })
        return;
      }

      connectionToBufferMap.set(event.getConnection(), [{ type: event.getPacket().getType(), contents: writer.getBuffer(), direction: "in" }]);
    });

    this.server.on("server.packet.out", event => {
      const res = connectionToBufferMap.get(event.getConnection());
      const writer = new MessageWriter();
      event.getPacket().serialize(writer);

      if (res) {
        res.push({ type: event.getPacket().getType(), contents: writer.getBuffer(), direction: "out" })
        return;
      }

      connectionToBufferMap.set(event.getConnection(), [{ type: event.getPacket().getType(), contents: writer.getBuffer(), direction: "out" }]);
    });

    this.server.on("connection.closed", event => {
      if (event.getConnection()?.getLobby()?.getGame() !== undefined) {
        const res = disconnectedPlayerLobbyMap.get(event.getConnection().getLobby()!);

        if (res) {
          res.push(event.getConnection());
          return;
        }

        disconnectedPlayerLobbyMap.set(event.getConnection().getLobby()!, [event.getConnection()])
      }
    });

    this.server.on("game.ended", event => {
      const connectionsInGame: Connection[] = [
        ...(disconnectedPlayerLobbyMap.get(event.getGame().getLobby()) ?? []),
        ...event.getGame().getLobby().getConnections(),
      ];

      const packets = new Map<Connection, { type: RootPacketType, contents: Buffer, direction: "in" | "out" }[]>();

      for (let i = 0; i < connectionsInGame.length; i++) {
        packets.set(connectionsInGame[i], connectionToBufferMap.get(connectionsInGame[i]) ?? [])
      }

      const writer = new MessageWriter();

      writer.writeListWithoutLength(packets.entries(), (subwriter, item) => {
        subwriter.writePackedUInt32(item[0].getId());
        subwriter.writeList(item[1], (subsubwriter, contents) => {
          subsubwriter.writeBoolean(contents.direction == "in");
          subsubwriter.writeByte(contents.type);
          subsubwriter.writeBytesAndSize(contents.contents);
        });
      });

      //TODO: Upload writer to DO space.
    })
  }
}

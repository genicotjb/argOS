import {
  World,
  addEntity,
  removeEntity,
  query,
  hasComponent,
  setComponent,
  addComponent,
  removeComponent,
} from "bitecs";
import { Room as RoomData, RoomState } from "../../types";
import {
  Agent,
  Room,
  Appearance,
  OccupiesRoom,
  Stimulus,
} from "../../components";
import { IRoomManager } from "./IRoomManager";
import { logger } from "../../utils/logger";
import { SimulationRuntime } from "../SimulationRuntime";
import { addStimulusToRoom as addStimulusToRoomRelation } from "../../components/relationships/stimulus";
import { getStimuliInRoom } from "../../components/relationships/stimulus";

export class RoomManager implements IRoomManager {
  constructor(private world: World, private runtime: SimulationRuntime) {}

  // Room CRUD
  createRoom(roomData: Partial<RoomData>): number {
    const roomEntity = addEntity(this.world);

    setComponent(this.world, roomEntity, Room, {
      id: roomData.id || String(roomEntity),
      name: roomData.name || "New Room",
      description: roomData.description || "",
      type: roomData.type || "physical",
    });

    logger.system(`Created room: ${roomData.name || "New Room"}`);
    return roomEntity;
  }

  getRooms(): RoomState[] {
    return query(this.world, [Room]).map((roomId) =>
      this.runtime.getStateManager().getRoomState(roomId)
    );
  }

  getRoomById(roomId: string): number | null {
    const rooms = query(this.world, [Room]);
    for (const eid of rooms) {
      if (Room.id[eid] === roomId) {
        return eid;
      }
    }
    return null;
  }

  deleteRoom(roomId: number): void {
    // First, move all occupants out
    const occupants = this.getRoomOccupants(roomId);
    for (const agentId of occupants) {
      removeComponent(this.world, agentId, OccupiesRoom(roomId));
    }

    removeEntity(this.world, roomId);
    logger.system(`Deleted room: ${Room.name[roomId]}`);
  }

  // Room occupancy
  moveAgentToRoom(agentId: number, roomId: number): void {
    // Verify room exists
    const rooms = query(this.world, [Room]);
    if (!rooms.includes(roomId)) {
      logger.error(`Room ${roomId} not found`, { roomId });
      return;
    }

    // Find and remove current room relationships
    const currentRooms = query(this.world, [Room]).filter((eid) =>
      hasComponent(this.world, agentId, OccupiesRoom(eid))
    );

    for (const currentRoom of currentRooms) {
      removeComponent(this.world, agentId, OccupiesRoom(currentRoom));
      logger.system(
        `Removed agent ${agentId} from room ${Room.name[currentRoom]}`
      );

      // Emit room update for the old room
      this.runtime.eventBus.emitRoomEvent(currentRoom, "state", {
        room: this.runtime.getStateManager().getRoomState(currentRoom),
      });
    }

    // Add new room relationship
    addComponent(this.world, agentId, OccupiesRoom(roomId));
    logger.system(`Added agent ${agentId} to room ${Room.name[roomId]}`);

    // Update agent's appearance to show room transition
    if (hasComponent(this.world, agentId, Appearance)) {
      Appearance.currentAction[agentId] = "entered the room";
      Appearance.lastUpdate[agentId] = Date.now();

      this.runtime.subscribeToLifecycle(
        "beforeSystems",
        async () => {
          // Update agent's appearance to be present after the room transition
          Appearance.currentAction[agentId] = "present";
          Appearance.lastUpdate[agentId] = Date.now();
        },
        { once: true }
      );
    }

    // Emit room update for the new room
    this.runtime.eventBus.emitRoomEvent(roomId, "state", {
      room: this.runtime.getStateManager().getRoomState(roomId),
    });

    this.runtime.notifyWorldStateChange();
  }

  getRoomOccupants(roomId: number): number[] {
    return query(this.world, [Agent]).filter((eid) =>
      hasComponent(this.world, eid, OccupiesRoom(roomId))
    );
  }

  getAgentRoom(agentId: number): number | null {
    const rooms = query(this.world, [Room]);
    for (const roomId of rooms) {
      if (hasComponent(this.world, agentId, OccupiesRoom(roomId))) {
        return roomId;
      }
    }
    return null;
  }

  // Room-specific operations
  getRoomStimuli(roomId: number): number[] {
    return getStimuliInRoom(this.world, roomId);
  }

  updateRoomState(roomId: number, updates: Partial<RoomData>): void {
    if (Room.id[roomId]) {
      setComponent(this.world, roomId, Room, {
        id: updates.id || Room.id[roomId],
        name: updates.name || Room.name[roomId],
        description: updates.description || Room.description[roomId],
        type: updates.type || Room.type[roomId],
      });

      // Emit room update
      this.runtime.eventBus.emitRoomEvent(roomId, "state", {
        room: this.runtime.getStateManager().getRoomState(roomId),
      });

      logger.system(`Updated room: ${Room.name[roomId]}`);
    }
  }

  addStimulusToRoom(stimulusId: number, roomId: number): void {
    if (!hasComponent(this.world, stimulusId, Stimulus)) {
      logger.error(`Stimulus ${stimulusId} not found`, { stimulusId });
      return;
    }

    if (!hasComponent(this.world, roomId, Room)) {
      logger.error(`Room ${roomId} not found`, { roomId });
      return;
    }

    // Add room relationship using the addStimulusToRoom helper
    addStimulusToRoomRelation(this.world, stimulusId, roomId, 1.0, {
      type: "room",
    });

    logger.debug(`Added stimulus ${stimulusId} to room ${Room.name[roomId]}`);
  }
}

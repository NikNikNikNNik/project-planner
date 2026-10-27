import assert from "node:assert/strict";
import test from "node:test";
import {
  getSaveErrorMessage,
  parseSaveRecoverySnapshot,
  serializeProjectSnapshot,
  shouldRestoreSaveRecovery,
} from "./save-recovery.ts";

test("save snapshots ignore only the server-generated updatedAt value", () => {
  assert.equal(
    serializeProjectSnapshot({ id: "p1", title: "План", updatedAt: "old" }),
    serializeProjectSnapshot({ id: "p1", title: "План", updatedAt: "new" }),
  );
  assert.notEqual(
    serializeProjectSnapshot({ id: "p1", title: "Старый план" }),
    serializeProjectSnapshot({ id: "p1", title: "Новый план" }),
  );
});

test("nested object key order never makes a successful API save look unsaved", () => {
  const editor = { id: 'p1', title: 'План', settings: { calculationMode: 'sequential', actualRecords: [{ id: 'a', date: '2026-10-27' }] }, training: [] };
  const server = { training: [], settings: { actualRecords: [{ date: '2026-10-27', id: 'a' }], calculationMode: 'sequential' }, title: 'План', id: 'p1', updatedAt: '2026-10-27T12:00:00Z' };
  assert.equal(serializeProjectSnapshot(editor), serializeProjectSnapshot(server));
  assert.notEqual(serializeProjectSnapshot(editor), serializeProjectSnapshot({ ...server, settings: { ...server.settings, actualRecords: [] } }));
});

test("recovery is offered only when its server baseline still matches", () => {
  const snapshot = {
    version: 1 as const,
    baseUpdatedAt: "2026-10-23T10:00:00.000Z",
    project: { id: "p1", title: "Локальные правки", updatedAt: "2026-10-23T10:00:00.000Z" },
  };
  assert.equal(shouldRestoreSaveRecovery(snapshot, {
    id: "p1",
    title: "Серверная версия",
    updatedAt: "2026-10-23T10:00:00.000Z",
  }), true);
  assert.equal(shouldRestoreSaveRecovery(snapshot, {
    id: "p1",
    title: "Более новая версия",
    updatedAt: "2026-10-23T11:00:00.000Z",
  }), false);
});

test("malformed recovery data is ignored and API error details stay readable", () => {
  assert.equal(parseSaveRecoverySnapshot("{broken"), null);
  assert.equal(parseSaveRecoverySnapshot('{"version":2}'), null);
  assert.equal(getSaveErrorMessage(new Error("HTTP 400 Bad Request: invalid role")), "invalid role");
});

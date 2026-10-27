import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./routes/projects.ts", import.meta.url), "utf8");
const registrations = [...source.matchAll(/router\.(get|post|put|delete)\("([^"]+)"/g)];
const routes = registrations.map((match, index) => ({
  key: `${match[1].toUpperCase()} ${match[2]}`,
  method: match[1],
  body: source.slice(match.index, registrations[index + 1]?.index ?? source.length),
}));

test("project routes expose each contract operation exactly once", () => {
  const keys = routes.map(route => route.key);
  assert.equal(new Set(keys).size, keys.length, "Duplicate route hides another handler");
  for (const key of [
    "GET /projects",
    "POST /projects",
    "GET /projects/:projectId",
    "PUT /projects/:projectId",
    "DELETE /projects/:projectId",
    "POST /projects/:projectId/copy",
  ]) {
    assert.ok(keys.includes(key), `Missing route: ${key}`);
  }
});

test("reading and copying projects never invoke deletion", () => {
  for (const route of routes) {
    if (route.method !== "delete") {
      assert.doesNotMatch(route.body, /\.delete\s*\(/, `${route.key} must not delete data`);
    }
  }
});

test("projects are created without access credentials", () => {
  const route = routes.find(item => item.key === "POST /projects");
  assert.ok(route);
  assert.match(route.body, /CreateProjectBody\.safeParse\(req\.body\)/);
  assert.match(route.body, /rejectInvalidTrainingRoleReferences\(input, res\)/);
  assert.doesNotMatch(route.body, /credentials|access|password|username/i);
});

test("project routes are accessible without application or per-project credentials", () => {
  const index = readFileSync(new URL("./routes/index.ts", import.meta.url), "utf8");
  assert.match(index, /router\.use\(projectsRouter\)/);
  assert.match(index, /router\.use\(projectsRouter\)/);
  assert.doesNotMatch(index, /auth\.|requireAuth|createAppAuth|express-session/);
  for (const route of routes) {
    assert.doesNotMatch(route.body, /requestHasProjectAccess|AuthenticateProjectBody|CopyProjectBody/);
  }
  assert.doesNotMatch(source, /router\.post\("\/projects\/:projectId\/access"/);
  assert.doesNotMatch(source, /project-access\/logout/);
});

test("saving a project updates its plan and validates deleted role assignments", () => {
  const route = routes.find(item => item.key === "PUT /projects/:projectId");
  assert.ok(route);
  assert.match(route.body, /\.update\(projectsTable\)/);
  assert.match(route.body, /rejectInvalidTrainingRoleReferences\(input, res\)/);
  assert.match(route.body, /projectPlanForStorage\(input\)/);
});

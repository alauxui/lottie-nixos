#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "skills/text-to-lottie");
const REFS_DIR = join(SKILLS_DIR, "references");
const PROJECTS_DIR = join(__dirname, "public/projects");

// --- MCP protocol helpers ---

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function ok(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

// --- Tool implementations ---

const tools = {
  get_skill: {
    description:
      "Returns the text-to-lottie SKILL.md — the main instruction set for generating Lottie JSON animations. Always call this first before generating or editing any Lottie scene.",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler() {
      const content = readFileSync(join(SKILLS_DIR, "SKILL.md"), "utf8");
      return { content: [{ type: "text", text: content }] };
    },
  },

  list_references: {
    description:
      "Lists all available reference documents for Lottie animation (recipes, spec, taste guides). Use to discover which references to load for a given task.",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler() {
      const files = readdirSync(REFS_DIR).filter((f) => f.endsWith(".md"));
      const list = files.map((f) => f.replace(".md", "")).join("\n");
      return { content: [{ type: "text", text: list }] };
    },
  },

  get_reference: {
    description:
      "Reads a specific reference document by name (without .md extension). Examples: player-contract, lottie-spec-map, recipe-logo, design-taste, motion-taste, recipe-typography, recipe-loaders-icons, recipe-svg-animation, recipe-ui-microinteractions, recipe-lower-thirds, recipe-camera-scene-motion, recipe-data-stats, recipe-diagram-technical, recipe-product-promo, recipe-visual-effects, recipe-starter-projects, svg-compatibility, chapterization-transition-grammar.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Reference name without .md extension, e.g. 'player-contract'",
        },
      },
      required: ["name"],
    },
    handler({ name }) {
      const filePath = join(REFS_DIR, `${name}.md`);
      if (!existsSync(filePath)) {
        throw new Error(`Reference '${name}' not found. Use list_references to see available ones.`);
      }
      const content = readFileSync(filePath, "utf8");
      return { content: [{ type: "text", text: content }] };
    },
  },

  list_scenes: {
    description:
      "Lists all projects and scenes in the Lottie player. Returns project slugs and their scene folders.",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler() {
      if (!existsSync(PROJECTS_DIR)) {
        return { content: [{ type: "text", text: "No projects found." }] };
      }
      const projects = readdirSync(PROJECTS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => {
          const scenesPath = join(PROJECTS_DIR, d.name);
          const scenes = readdirSync(scenesPath, { withFileTypes: true })
            .filter((s) => s.isDirectory() && existsSync(join(scenesPath, s.name, "lottie.json")))
            .map((s) => s.name);
          return `${d.name}: ${scenes.join(", ") || "(no scenes)"}`;
        });
      return { content: [{ type: "text", text: projects.join("\n") }] };
    },
  },

  read_scene: {
    description:
      "Reads the lottie.json for a given project and scene. Always call this before overwriting an existing scene.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project slug, e.g. 'main-project'" },
        scene: { type: "string", description: "Scene folder name, e.g. 'scene-1'" },
      },
      required: ["project", "scene"],
    },
    handler({ project, scene }) {
      const filePath = join(PROJECTS_DIR, project, scene, "lottie.json");
      if (!existsSync(filePath)) {
        throw new Error(`Scene not found: public/projects/${project}/${scene}/lottie.json`);
      }
      const content = readFileSync(filePath, "utf8");
      return { content: [{ type: "text", text: content }] };
    },
  },

  write_scene: {
    description:
      "Writes lottie.json (and optionally controls.json) to a project/scene path. Creates the scene folder if it does not exist. Validates JSON before writing.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project slug, e.g. 'main-project'" },
        scene: { type: "string", description: "Scene folder name, e.g. 'scene-2'" },
        lottie: { type: "string", description: "The full lottie.json content as a JSON string" },
        controls: {
          type: "string",
          description: "Optional controls.json content as a JSON string",
        },
      },
      required: ["project", "scene", "lottie"],
    },
    handler({ project, scene, lottie, controls }) {
      // Validate JSON
      let parsed;
      try {
        parsed = JSON.parse(lottie);
      } catch (e) {
        throw new Error(`Invalid lottie JSON: ${e.message}`);
      }

      const sceneDir = join(PROJECTS_DIR, project, scene);
      mkdirSync(sceneDir, { recursive: true });

      const lottiePath = join(sceneDir, "lottie.json");
      writeFileSync(lottiePath, JSON.stringify(parsed, null, 2));

      let written = `Written: public/projects/${project}/${scene}/lottie.json`;

      if (controls) {
        let parsedControls;
        try {
          parsedControls = JSON.parse(controls);
        } catch (e) {
          throw new Error(`Invalid controls JSON: ${e.message}`);
        }
        writeFileSync(join(sceneDir, "controls.json"), JSON.stringify(parsedControls, null, 2));
        written += `\nWritten: public/projects/${project}/${scene}/controls.json`;
      }

      return { content: [{ type: "text", text: written }] };
    },
  },
};

// --- MCP request router ---

function handle(req) {
  const { id, method, params } = req;

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "lottie-mcp", version: "1.0.0" },
    });
  }

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    return ok(id, {
      tools: Object.entries(tools).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params;
    const tool = tools[name];
    if (!tool) return error(id, -32601, `Unknown tool: ${name}`);
    try {
      const result = tool.handler(args);
      return ok(id, result);
    } catch (e) {
      return ok(id, {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      });
    }
  }

  error(id, -32601, `Method not found: ${method}`);
}

// --- Stdio transport ---

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  handle(req);
});

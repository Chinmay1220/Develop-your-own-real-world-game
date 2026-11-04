import assert from "node:assert/strict";
import { test } from "node:test";
import { modelBounds } from "../src/tools/polyhaven.ts";

test("a model's size comes from its glTF: positions moved by the node transforms, ignoring less detailed versions", () => {
  const box = { min: [-0.5, 0, -0.25], max: [0.5, 2, 0.25] }; // 1 × 2 × 0.5 m
  const gltf = {
    scene: 0,
    scenes: [{ nodes: [0, 2] }],
    nodes: [
      { name: "chair_LOD0", children: [1], translation: [10, 0, 0] },
      { name: "seat", mesh: 0, scale: [2, 1, 1] }, // 2 × 2 × 0.5, at x = 10
      { name: "chair_LOD1", mesh: 0, translation: [100, 100, 100] }, // ignored
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [box],
  };
  assert.deepEqual(modelBounds(gltf), { min: [9, 0, -0.25], max: [11, 2, 0.25] });

  // A quarter turn about y swaps width and depth.
  const turned = { ...gltf, nodes: [{ name: "a", mesh: 0, rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] }], scenes: [{ nodes: [0] }] };
  const bounds = modelBounds(turned)!;
  assert.deepEqual(bounds.max.map((value, i) => Math.round((value - bounds.min[i]) * 1000) / 1000), [0.5, 2, 1]);
  assert.equal(modelBounds({ nodes: [], meshes: [], accessors: [], scenes: [{ nodes: [] }] }), null);
});

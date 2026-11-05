// Breaks up the repetition of a tiled texture. Each patch of the surface uses the texture shifted by a
// different amount, blended smoothly into the next, so a big ground no longer shows a grid of identical
// copies. Colour, bumps and roughness shift together, so they stay matched.
// Technique 3 of Inigo Quilez's "texture repetition" (https://iquilezles.org/articles/texturerepetition/).
import * as THREE from "three";

const FUNCTIONS = /* glsl */ `
float noTileHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noTileNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(noTileHash(i), noTileHash(i + vec2(1.0, 0.0)), u.x), mix(noTileHash(i + vec2(0.0, 1.0)), noTileHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec4 noTile(sampler2D samp, vec2 uv) {
  float l = noTileNoise(uv * 0.45) * 8.0; // which shifted copy: changes every couple of copies
  float index = floor(l);
  vec2 a = sin(vec2(3.0, 7.0) * index);
  vec2 b = sin(vec2(3.0, 7.0) * (index + 1.0));
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  return mix(textureGrad(samp, uv + a, dx, dy), textureGrad(samp, uv + b, dx, dy), smoothstep(0.2, 0.8, fract(l)));
}
`;

/** Makes a MeshStandardMaterial's colour, normal and roughness maps hide their repetition. */
export function breakUpRepetition(material) {
  material.onBeforeCompile = (shader) => {
    const chunk = (name, from, to) => THREE.ShaderChunk[name].replace(from, to);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FUNCTIONS}`)
      .replace("#include <map_fragment>", chunk("map_fragment", /texture2D\( map, vMapUv \)/g, "noTile( map, vMapUv )"))
      .replace("#include <normal_fragment_maps>", chunk("normal_fragment_maps", /texture2D\( normalMap, vNormalMapUv \)/g, "noTile( normalMap, vNormalMapUv )"))
      .replace("#include <roughnessmap_fragment>", chunk("roughnessmap_fragment", /texture2D\( roughnessMap, vRoughnessMapUv \)/g, "noTile( roughnessMap, vRoughnessMapUv )"));
  };
  material.customProgramCacheKey = () => "no-tile";
  material.needsUpdate = true;
  return material;
}

////////////////////////////////////////////////////////////////////////////////
// Constants
////////////////////////////////////////////////////////////////////////////////
const GroundHeight = -1.0;
const ShadowBias = -0.0001;

////////////////////////////////////////////////////////////////////////////////
// Structures
////////////////////////////////////////////////////////////////////////////////
struct ViewParams {
  shadow_model_view_proj : mat4x4<f32>,
  camera_model_view_proj : mat4x4<f32>,
  camera_right : vec3<f32>,
  camera_up : vec3<f32>,
  camera_forward : vec3<f32>,
  light_dir : vec3<f32>,
}

struct Particle {
  position : vec3f,
  lifetime : f32,
  color    : vec4f,
  velocity : vec3f,
  size     : f32,
  age      : f32,
}

////////////////////////////////////////////////////////////////////////////////
// Bindings
////////////////////////////////////////////////////////////////////////////////
@binding(0) @group(0) var<uniform> view_params : ViewParams;
@binding(0) @group(1) var<storage, read> particles : array<Particle>;
@binding(1) @group(1) var<storage, read> particleIndices: array<u32>;
@binding(2) @group(1) var shadow_depth : texture_depth_2d;
@binding(3) @group(1) var shadow_depth_sampler : sampler_comparison;


////////////////////////////////////////////////////////////////////////////////
// Utilities
////////////////////////////////////////////////////////////////////////////////
var<private> rand_seed : vec2f;

fn init_rand(invocation_id : u32, seed : vec4f) {
  rand_seed = seed.xz;
  rand_seed = fract(rand_seed * cos(35.456+f32(invocation_id) * seed.yw));
  rand_seed = fract(rand_seed * cos(41.235+f32(invocation_id) * seed.xw));
}

fn rand() -> f32 {
  rand_seed.x = fract(cos(dot(rand_seed, vec2f(23.14077926, 232.61690225))) * 136.8168);
  rand_seed.y = fract(cos(dot(rand_seed, vec2f(54.47856553, 345.84153136))) * 534.7645);
  return rand_seed.y;
}

fn lit(shadow_clip_space : vec4f) -> f32 {
  let shadow_ndc = shadow_clip_space / shadow_clip_space.w;
  let shadow_uv = shadow_ndc.xy * vec2(0.5, -0.5) + vec2(0.5);
  var shadow = 0.0;
  shadow += textureSampleCompare(shadow_depth, shadow_depth_sampler, shadow_uv, shadow_ndc.z + ShadowBias, vec2(-1, -1));
  shadow += textureSampleCompare(shadow_depth, shadow_depth_sampler, shadow_uv, shadow_ndc.z + ShadowBias, vec2( 0, -1));
  shadow += textureSampleCompare(shadow_depth, shadow_depth_sampler, shadow_uv, shadow_ndc.z + ShadowBias, vec2( 1, -1));
  shadow += textureSampleCompare(shadow_depth, shadow_depth_sampler, shadow_uv, shadow_ndc.z + ShadowBias, vec2(-1,  0));
  shadow += textureSampleCompare(shadow_depth, shadow_depth_sampler, shadow_uv, shadow_ndc.z + ShadowBias, vec2( 0,  0));
  shadow += textureSampleCompare(shadow_depth, shadow_depth_sampler, shadow_uv, shadow_ndc.z + ShadowBias, vec2( 1,  0));
  shadow += textureSampleCompare(shadow_depth, shadow_depth_sampler, shadow_uv, shadow_ndc.z + ShadowBias, vec2(-1,  1));
  shadow += textureSampleCompare(shadow_depth, shadow_depth_sampler, shadow_uv, shadow_ndc.z + ShadowBias, vec2( 0,  1));
  shadow += textureSampleCompare(shadow_depth, shadow_depth_sampler, shadow_uv, shadow_ndc.z + ShadowBias, vec2( 1,  1));
  return 1 - shadow / 9;
}

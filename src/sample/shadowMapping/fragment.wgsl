// TODO: Use pipeline constants
const shadowDepthTextureSize = 1024;

struct Scene {
  lightViewProjMatrix : mat4x4<f32>,
  cameraViewProjMatrix : mat4x4<f32>,
  lightPos : vec3f,
}

@group(0) @binding(0) var<uniform> scene : Scene;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;

struct FragmentInput {
  @location(0) shadowPos : vec3f,
  @location(1) fragPos : vec3f,
  @location(2) fragNorm : vec3f,
}

const albedo = vec3(0.9);
const ambientFactor = 0.2;

@fragment
fn main(input : FragmentInput) -> @location(0) vec4f {
  // Percentage-closer filtering. Sample texels in the region
  // to smooth the result.
  var visibility = 0f;
  let oneOverShadowDepthTextureSize = 1 / shadowDepthTextureSize;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let offset = vec2f(vec2(x, y)) * oneOverShadowDepthTextureSize;

      visibility += textureSampleCompare(
        shadowMap, shadowSampler,
        input.shadowPos.xy + offset, input.shadowPos.z - 0.007
      );
    }
  }
  visibility /= 9;

  let lambertFactor = max(dot(normalize(scene.lightPos - input.fragPos), input.fragNorm), 0);
  let lightingFactor = min(ambientFactor + visibility * lambertFactor, 1);

  return vec4(lightingFactor * albedo, 1);
}

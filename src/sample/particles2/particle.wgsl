////////////////////////////////////////////////////////////////////////////////
// Vertex shader
////////////////////////////////////////////////////////////////////////////////
struct VertexInput {
  @builtin(instance_index) index : u32,
  @location(0) quad_pos : vec2f, // -1..+1
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) color          : vec4f,
  @location(1) quad_pos       : vec2f, // -1..+1
  @location(2) shadow_coords  : vec4f,
}

@vertex
fn vs_main(in : VertexInput) -> VertexOutput {
  let particle = particles[particleIndices[in.index]];
  var quad_pos = mat2x3<f32>(view_params.camera_right, view_params.camera_up) * in.quad_pos;
  var position = particle.position + quad_pos * particle.size;
  var out : VertexOutput;
  out.position = view_params.camera_model_view_proj * vec4f(position, 1.0);
  out.color = particle.color;
  out.quad_pos = in.quad_pos;
  out.shadow_coords = view_params.shadow_model_view_proj * vec4f(position, 1.0);
  return out;
}

// Returns a circular particle alpha value
fn particle_alpha(in : VertexOutput) -> f32 {
  return smoothstep(1.0, 0.75, length(in.quad_pos)) * in.color.a;
}

////////////////////////////////////////////////////////////////////////////////
// Fragment shader - shadow
////////////////////////////////////////////////////////////////////////////////
@fragment
fn fs_shadow_main(in : VertexOutput) -> @location(0) vec4f {
  if (particle_alpha(in) < rand()) {
    discard;
  }
  return vec4f(1);
}

////////////////////////////////////////////////////////////////////////////////
// Fragment shader - draw
////////////////////////////////////////////////////////////////////////////////
@fragment
fn fs_draw_main(in : VertexOutput) -> @location(0) vec4f {
  let view_normal = normalize(vec3f(in.quad_pos, length(in.quad_pos) - 1));
  let world_normal = mat3x3(view_params.camera_right,
                            view_params.camera_up,
                            view_params.camera_forward) * view_normal;
  let dp = max(dot(world_normal, -view_params.light_dir), 0);
  let specular = pow(max(dot(reflect(view_params.camera_forward, world_normal), -view_params.light_dir), 0), 10);
  var color = in.color.rgb;
  color *= 0.2 + dp * mix(0.2, 0.8 + specular, lit(in.shadow_coords));
  return vec4(color.rgb, 1) * particle_alpha(in);
}

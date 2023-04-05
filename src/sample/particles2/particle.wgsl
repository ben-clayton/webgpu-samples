////////////////////////////////////////////////////////////////////////////////
// Vertex shader
////////////////////////////////////////////////////////////////////////////////
struct VertexInput {
  @location(0) position : vec3f,
  @location(1) color : vec4f,
  @location(2) quad_pos : vec2f, // -1..+1
}

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) color          : vec4f,
  @location(1) quad_pos       : vec2f, // -1..+1
  @location(2) shadow_coords  : vec4f,
}

@vertex
fn vs_main(in : VertexInput) -> VertexOutput {
  var quad_pos = mat2x3<f32>(view_params.camera_right, view_params.camera_up) * in.quad_pos;
  var position = in.position + quad_pos * 0.015;
  var out : VertexOutput;
  out.position = view_params.camera_model_view_proj * vec4f(position, 1.0);
  out.color = in.color;
  out.quad_pos = in.quad_pos;
  out.shadow_coords = view_params.shadow_model_view_proj * vec4f(position, 1.0);
  return out;
}

// Returns a circular particle alpha value
fn particle_alpha(in : VertexOutput) -> f32 {
  return smoothstep(1.0, 0.5, length(in.quad_pos)) * in.color.a;
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
  var color = in.color.rgb;
  color *= 0.2 * lighting(in.shadow_coords);
  return vec4(color.rgb, particle_alpha(in));
}

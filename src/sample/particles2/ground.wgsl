struct VertexOut {
    @builtin(position) pos           : vec4f,
    @location(0)       shadow_coords : vec4f,
    @location(1)       coords        : vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOut {
  const pos_a = vec3f(-3, -3, ground_height); // a ---- b
  const pos_b = vec3f( 3, -3, ground_height); // |      |
  const pos_c = vec3f(-3,  3, ground_height); // |      |
  const pos_d = vec3f( 3,  3, ground_height); // c ---- d
  const coord_a = vec2f(0, 0);
  const coord_b = vec2f(1, 0);
  const coord_c = vec2f(0, 1);
  const coord_d = vec2f(1, 1);
  const positions = array(pos_a, pos_c, pos_b, pos_c, pos_d, pos_b);
  const coords = array(coord_a, coord_c, coord_b, coord_c, coord_d, coord_b);
  var pos = vec4f(positions[VertexIndex], 1);
  return VertexOut(view_params.camera_model_view_proj * pos,
                   view_params.shadow_model_view_proj * pos,
                   coords[VertexIndex]);
}

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
  let f = fract(in.coords*4);
  let diffuse = select(vec3(0.3, 0.3, 0.3),
                       vec3(0.2, 0.2, 0.2),
                       (f.x < 0.5) != (f.y < 0.5));
  return vec4(diffuse * lighting(in.shadow_coords), 1);
}

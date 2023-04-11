////////////////////////////////////////////////////////////////////////////////
// Simulation Compute shader
////////////////////////////////////////////////////////////////////////////////
const ParticleMinRadius = 0.01;
const ParticleMaxRadius = 0.03;

struct SimulationParams {
  deltaTime : f32,
  seed : vec4f,
}

struct Particles {
  particles : array<Particle>,
}

@binding(0) @group(0) var<uniform> sim_params : SimulationParams;
@binding(1) @group(0) var<storage, read_write> data : Particles;
@binding(2) @group(0) var texture : texture_2d<f32>;

@compute @workgroup_size(64)
fn simulate(@builtin(global_invocation_id) global_invocation_id : vec3<u32>) {
  let idx = global_invocation_id.x;

  init_rand(idx, sim_params.seed);

  var particle = data.particles[idx];

  // Apply gravity
  particle.velocity.z = particle.velocity.z - sim_params.deltaTime * 0.5;

  // Basic velocity integration
  particle.position = particle.position + sim_params.deltaTime * particle.velocity;

  // Bounce off ground plane
  if particle.position.z < GroundHeight+ParticleMaxRadius {
    particle.position.z = GroundHeight+ParticleMaxRadius;
    var velocity_xy = particle.velocity.xy;
    velocity_xy = mix(velocity_xy, vec2(rand() - 0.5, rand() - 0.5) * length(particle.velocity), 0.5);
    particle.velocity = vec3(velocity_xy, -particle.velocity.z);
    particle.velocity *= 0.5;
  }

  // If the lifetime has gone negative, then the particle is dead and should be
  // respawned.
  if particle.lifetime <= 0.0 {
    // Use the probability map to find where the particle should be spawned.
    // Starting with the 1x1 mip level.
    var coord : vec2<i32>;
    for (var level = u32(textureNumLevels(texture) - 1); level > 0; level--) {
      // Load the probability value from the mip-level
      // Generate a random number and using the probabilty values, pick the
      // next texel in the next largest mip level:
      //
      // 0.0    probabilites.r    probabilites.g    probabilites.b   1.0
      //  |              |              |              |              |
      //  |   TOP-LEFT   |  TOP-RIGHT   | BOTTOM-LEFT  | BOTTOM_RIGHT |
      //
      let probabilites = textureLoad(texture, coord, level);
      let value = vec4f(rand());
      let mask = (value >= vec4f(0.0, probabilites.xyz)) & (value < probabilites);
      coord = coord * 2;
      coord.x = coord.x + select(0, 1, any(mask.yw)); // x  y
      coord.y = coord.y + select(0, 1, any(mask.zw)); // z  w
    }
    let uv = vec2f(coord) / vec2f(textureDimensions(texture));
    particle.position = vec3f((uv - 0.5) * 3.0 * vec2f(1.0, -1.0), 0.0);
    particle.color = textureLoad(texture, coord, 0);
    particle.velocity.x = (rand() - 0.5) * 0.05;
    particle.velocity.y = (rand() - 0.5) * 0.05;
    particle.velocity.z = rand() * 0.1;
    particle.age = 0;
    particle.lifetime = 1.0 + rand() * 5.0;
    particle.size = mix(ParticleMinRadius, ParticleMaxRadius, rand());
  }

  // Age each particle. Fade in at birth and out before vanishing.
  particle.lifetime = particle.lifetime - sim_params.deltaTime;
  particle.age += sim_params.deltaTime;
  particle.color.a = smoothstep(0, 1.0, particle.lifetime) * smoothstep(0, 0.2, particle.age);

  // Store the new particle value
  data.particles[idx] = particle;
}

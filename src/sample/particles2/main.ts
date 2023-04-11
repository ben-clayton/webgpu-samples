import { mat4, vec3 } from 'gl-matrix';
import { makeSample, SampleInit } from '../../components/SampleLayout';
import { ComparisonElementType, createIndexSorter } from 'webgpu-sort';

import commonWGSL from './common.wgsl';
import groundWGSL from './ground.wgsl';
import particleWGSL from './particle.wgsl';
import simulationWGSL from './simulation.wgsl';
import probabilityMapWGSL from './probabilityMap.wgsl';

const numParticles = 30000;
const shadowResolution = 1024;
// const particlePositionOffset = 0;
// const particleColorOffset = 4 * 4;
const particleInstanceByteSize =
  3 * 4 + // position
  1 * 4 + // lifetime
  4 * 4 + // color
  3 * 4 + // velocity
  1 * 4 + // padding
  0;

const init: SampleInit = async ({ canvas, pageState, gui }) => {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  if (!pageState.active) return;
  const context = canvas.getContext('webgpu') as GPUCanvasContext;

  const devicePixelRatio = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format: presentationFormat,
    alphaMode: 'opaque',
  });

  const particlesBuffer = device.createBuffer({
    size: numParticles * particleInstanceByteSize,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  });

  const particleIndexBuffer = device.createBuffer({
    size: numParticles * 4,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE,
  });

  //////////////////////////////////////////////////////////////////////////////
  // Shadow objects
  //////////////////////////////////////////////////////////////////////////////
  const shadowDepthTexture = device.createTexture({
    size: [shadowResolution, shadowResolution],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

  const shadowPassDescriptor: GPURenderPassDescriptor = {
    colorAttachments: [null],
    depthStencilAttachment: {
      view: shadowDepthTexture.createView(),

      depthClearValue: 1.0,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  };

  const shadowBuffersLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { viewDimension: '2d', sampleType: 'depth' },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'comparison' },
      },
    ],
  });
  const shadowBuffersBindGroup = device.createBindGroup({
    layout: shadowBuffersLayout,
    entries: [
      {
        binding: 0,
        resource: {
          buffer: particlesBuffer,
          offset: 0,
          size: numParticles * particleInstanceByteSize,
        },
      },
      {
        binding: 1,
        resource: {
          buffer: particleIndexBuffer,
          offset: 0,
          size: numParticles * 4,
        },
      },
      {
        binding: 2,
        resource: shadowDepthTexture.createView({ format: 'depth24plus' }),
      },
      {
        binding: 3,
        resource: device.createSampler({ compare: 'greater' }),
      },
    ],
  });

  //////////////////////////////////////////////////////////////////////////////
  // Scene objects
  //////////////////////////////////////////////////////////////////////////////
  const viewParamsLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' },
      },
    ],
  });

  const groundRenderPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [viewParamsLayout, shadowBuffersLayout],
    }),
    vertex: {
      module: device.createShaderModule({ code: commonWGSL + groundWGSL }),
      entryPoint: 'vs_main',
      buffers: [],
    },
    fragment: {
      module: device.createShaderModule({ code: commonWGSL + groundWGSL }),
      entryPoint: 'fs_main',
      targets: [
        {
          format: presentationFormat,
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth24plus',
    },
  });

  const particlesVertexState: GPUVertexState = {
    module: device.createShaderModule({ code: commonWGSL + particleWGSL }),
    entryPoint: 'vs_main',
    buffers: [
      {
        // quad vertex buffer
        arrayStride: 2 * 4, // vec2<f32>
        stepMode: 'vertex',
        attributes: [
          {
            // vertex positions
            shaderLocation: 0,
            offset: 0,
            format: 'float32x2',
          },
        ],
      },
    ],
  };

  const renderParticlesLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' },
      },
    ],
  });

  const renderParticlesBindGroup = device.createBindGroup({
    layout: renderParticlesLayout,
    entries: [
      {
        binding: 0,
        resource: {
          buffer: particlesBuffer,
          offset: 0,
          size: numParticles * particleInstanceByteSize,
        },
      },
      {
        binding: 1,
        resource: {
          buffer: particleIndexBuffer,
          offset: 0,
          size: numParticles * 4,
        },
      },
    ],
  });

  const particlesShadowRenderPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [viewParamsLayout, renderParticlesLayout],
    }),
    vertex: particlesVertexState,
    fragment: {
      module: device.createShaderModule({ code: commonWGSL + particleWGSL }),
      entryPoint: 'fs_shadow_main',
      targets: [null],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth24plus',
    },
  });

  const particlesDrawRenderPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [viewParamsLayout, shadowBuffersLayout],
    }),
    vertex: particlesVertexState,
    fragment: {
      module: device.createShaderModule({ code: commonWGSL + particleWGSL }),
      entryPoint: 'fs_draw_main',
      targets: [
        {
          format: presentationFormat,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
      depthWriteEnabled: false,
      depthCompare: 'less',
      format: 'depth24plus',
    },
  });

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const viewParamsBufferSize =
    4 * 4 * 4 + // shadow_model_view_proj : mat4x4<f32>
    4 * 4 * 4 + // camera_model_view_proj : mat4x4<f32>
    3 * 4 + // camera_right : vec3<f32>
    4 + // padding
    3 * 4 + // camera_up : vec3<f32>
    4 + // padding
    0;
  const viewParamsBuffer = device.createBuffer({
    size: viewParamsBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const shadowViewParamsBuffer = device.createBuffer({
    size: viewParamsBufferSize,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const renderViewParamsBuffer = device.createBuffer({
    size: viewParamsBufferSize,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });

  const viewParamsBindGroup = device.createBindGroup({
    layout: viewParamsLayout,
    entries: [
      {
        binding: 0,
        resource: { buffer: viewParamsBuffer },
      },
    ],
  });

  const renderPassDescriptor: GPURenderPassDescriptor = {
    colorAttachments: [
      {
        view: undefined, // Assigned later
        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
    depthStencilAttachment: {
      view: depthTexture.createView(),

      depthClearValue: 1.0,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  };

  const particlesSorter = createIndexSorter({
    device,
    type: {
      type: 'Particle',
      definition: `
      struct Particle {
        position : vec3f,
        lifetime : f32,
        color    : vec4f,
        velocity : vec3f,
      }`,
      dist: {
        distType: ComparisonElementType.f32,
        entryPoint: '_dist',
        code: `
        struct ViewParams {
          shadow_model_view_proj : mat4x4<f32>,
          camera_model_view_proj : mat4x4<f32>,
          camera_right : vec3<f32>,
          camera_up : vec3<f32>,
        }
        @binding(0) @group(1) var<uniform> view_params : ViewParams;

        fn _dist(p: Particle) -> f32 {
          return length(view_params.camera_model_view_proj * vec4f(p.position, 1.0));
        }
        `,
        bindGroups: [
          {
            index: 1,
            bindGroupLayout: viewParamsLayout,
            bindGroup: viewParamsBindGroup,
          },
        ],
      },
    },
    n: numParticles,
    mode: 'descending',
    buffer: particlesBuffer,
    indices: particleIndexBuffer,
  });

  //////////////////////////////////////////////////////////////////////////////
  // Quad vertex buffer
  //////////////////////////////////////////////////////////////////////////////
  const quadVertexBuffer = device.createBuffer({
    size: 6 * 2 * 4, // 6x vec2<f32>
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  // prettier-ignore
  const vertexData = [
    -1.0, -1.0, +1.0, -1.0, -1.0, +1.0, -1.0, +1.0, +1.0, -1.0, +1.0, +1.0,
  ];
  new Float32Array(quadVertexBuffer.getMappedRange()).set(vertexData);
  quadVertexBuffer.unmap();

  //////////////////////////////////////////////////////////////////////////////
  // WGPU Texture
  //////////////////////////////////////////////////////////////////////////////
  let wgpuTexture: GPUTexture;
  let wgpuTextureWidth = 1;
  let wgpuTextureHeight = 1;
  let wgpuNumMipLevels = 1;
  {
    const img = document.createElement('img');
    img.src = new URL(
      '../../../assets/img/webgpu.png',
      import.meta.url
    ).toString();
    await img.decode();
    const imageBitmap = await createImageBitmap(img);

    // Calculate number of mip levels required to generate the probability map
    while (
      wgpuTextureWidth < imageBitmap.width ||
      wgpuTextureHeight < imageBitmap.height
    ) {
      wgpuTextureWidth *= 2;
      wgpuTextureHeight *= 2;
      wgpuNumMipLevels++;
    }
    wgpuTexture = device.createTexture({
      size: [imageBitmap.width, imageBitmap.height, 1],
      mipLevelCount: wgpuNumMipLevels,
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: imageBitmap },
      { texture: wgpuTexture },
      [imageBitmap.width, imageBitmap.height]
    );
  }

  //////////////////////////////////////////////////////////////////////////////
  // Probability map generation
  // The 0'th mip level of texture holds the color data and spawn-probability in
  // the alpha channel. The mip levels 1..N are generated to hold spawn
  // probabilities up to the top 1x1 mip level.
  //////////////////////////////////////////////////////////////////////////////
  {
    const probabilityMapImportLevelPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({
          code: commonWGSL + probabilityMapWGSL,
        }),
        entryPoint: 'import_level',
      },
    });
    const probabilityMapExportLevelPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({
          code: commonWGSL + probabilityMapWGSL,
        }),
        entryPoint: 'export_level',
      },
    });

    const probabilityMapUBOBufferSize =
      1 * 4 + // stride
      3 * 4 + // padding
      0;
    const probabilityMapUBOBuffer = device.createBuffer({
      size: probabilityMapUBOBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const buffer_a = device.createBuffer({
      size: wgpuTextureWidth * wgpuTextureHeight * 4,
      usage: GPUBufferUsage.STORAGE,
    });
    const buffer_b = device.createBuffer({
      size: wgpuTextureWidth * wgpuTextureHeight * 4,
      usage: GPUBufferUsage.STORAGE,
    });
    device.queue.writeBuffer(
      probabilityMapUBOBuffer,
      0,
      new Int32Array([wgpuTextureWidth])
    );
    const commandEncoder = device.createCommandEncoder();
    for (let level = 0; level < wgpuNumMipLevels; level++) {
      const levelWidth = wgpuTextureWidth >> level;
      const levelHeight = wgpuTextureHeight >> level;
      const pipeline =
        level == 0
          ? probabilityMapImportLevelPipeline.getBindGroupLayout(0)
          : probabilityMapExportLevelPipeline.getBindGroupLayout(0);
      const probabilityMapBindGroup = device.createBindGroup({
        layout: pipeline,
        entries: [
          {
            // ubo
            binding: 0,
            resource: { buffer: probabilityMapUBOBuffer },
          },
          {
            // buf_in
            binding: 1,
            resource: { buffer: level & 1 ? buffer_a : buffer_b },
          },
          {
            // buf_out
            binding: 2,
            resource: { buffer: level & 1 ? buffer_b : buffer_a },
          },
          {
            // tex_in / tex_out
            binding: 3,
            resource: wgpuTexture.createView({
              format: 'rgba8unorm',
              dimension: '2d',
              baseMipLevel: level,
              mipLevelCount: 1,
            }),
          },
        ],
      });
      if (level == 0) {
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(probabilityMapImportLevelPipeline);
        passEncoder.setBindGroup(0, probabilityMapBindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(levelWidth / 64), levelHeight);
        passEncoder.end();
      } else {
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(probabilityMapExportLevelPipeline);
        passEncoder.setBindGroup(0, probabilityMapBindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(levelWidth / 64), levelHeight);
        passEncoder.end();
      }
    }
    device.queue.submit([commandEncoder.finish()]);
  }

  //////////////////////////////////////////////////////////////////////////////
  // Simulation compute pipeline
  //////////////////////////////////////////////////////////////////////////////
  const simulationParams = {
    simulate: true,
    viewFromLight: false,
    drawParticles: true,
    deltaTime: 0.04,
  };

  const simulationUBOBufferSize =
    1 * 4 + // deltaTime
    3 * 4 + // padding
    4 * 4 + // seed
    0;
  const simulationUBOBuffer = device.createBuffer({
    size: simulationUBOBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  Object.keys(simulationParams).forEach((k) => {
    gui.add(simulationParams, k);
  });

  const simulationPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({
        code: commonWGSL + simulationWGSL,
      }),
      entryPoint: 'simulate',
    },
  });
  const computeBindGroup = device.createBindGroup({
    layout: simulationPipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: simulationUBOBuffer,
        },
      },
      {
        binding: 1,
        resource: {
          buffer: particlesBuffer,
          offset: 0,
          size: numParticles * particleInstanceByteSize,
        },
      },
      {
        binding: 2,
        resource: wgpuTexture.createView(),
      },
    ],
  });

  const aspect = canvas.width / canvas.height;
  const shadowProjection = mat4.create();
  const shadowView = mat4.create();
  const shadowMVP = mat4.create();

  mat4.perspective(shadowProjection, (2 * Math.PI) / 5, 1, 0.01, 10.0);

  const updateViewParams = (
    buffer: GPUBuffer,
    shadowMVP: mat4,
    cameraMVP: mat4,
    cameraView: mat4
  ) => {
    // prettier-ignore
    device.queue.writeBuffer(
      buffer,
      0,
      new Float32Array([
        // shadow_model_view_proj
        shadowMVP[0], shadowMVP[1], shadowMVP[2], shadowMVP[3],
        shadowMVP[4], shadowMVP[5], shadowMVP[6], shadowMVP[7],
        shadowMVP[8], shadowMVP[9], shadowMVP[10], shadowMVP[11],
        shadowMVP[12], shadowMVP[13], shadowMVP[14], shadowMVP[15],

        // camera_model_view_proj
        cameraMVP[0], cameraMVP[1], cameraMVP[2], cameraMVP[3],
        cameraMVP[4], cameraMVP[5], cameraMVP[6], cameraMVP[7],
        cameraMVP[8], cameraMVP[9], cameraMVP[10], cameraMVP[11],
        cameraMVP[12], cameraMVP[13], cameraMVP[14], cameraMVP[15],

        cameraView[0], cameraView[4], cameraView[8], // camera_right

        0, // padding

        cameraView[1], cameraView[5], cameraView[9], // camera_up

        0, // padding
      ])
    );
  };

  let time = 0.0;
  let cameraRotation = 0.0;
  let lightRotation = 0.0;

  const cameraProjection = mat4.create();
  const cameraView = mat4.create();
  const cameraMVP = mat4.create();
  mat4.perspective(cameraProjection, (2 * Math.PI) / 5, aspect, 0.01, 10.0);

  function frame() {
    // Sample is no longer the active page.
    if (!pageState.active) return;

    time += simulationParams.deltaTime;
    cameraRotation = 0.1 * Math.cos(0.1 * time);
    lightRotation += 0.1 * simulationParams.deltaTime;

    device.queue.writeBuffer(
      simulationUBOBuffer,
      0,
      new Float32Array([
        simulationParams.simulate ? simulationParams.deltaTime : 0.0,
        0.0,
        0.0,
        0.0, // padding
        Math.random() * 100,
        Math.random() * 100, // seed.xy
        1 + Math.random(),
        1 + Math.random(), // seed.zw
      ])
    );

    // Update the shadow views
    {
      mat4.lookAt(
        shadowView,
        vec3.fromValues(
          2.5 * Math.sin(lightRotation),
          2.5 * -Math.cos(lightRotation),
          2
        ),
        vec3.fromValues(0, 0, -1),
        vec3.fromValues(0, 0, 1)
      );
      mat4.multiply(shadowMVP, shadowProjection, shadowView);
      updateViewParams(
        shadowViewParamsBuffer,
        shadowMVP,
        shadowMVP,
        shadowView
      );
    }

    // Update the camera views
    {
      mat4.lookAt(
        cameraView,
        vec3.fromValues(
          2 * Math.sin(cameraRotation),
          2 * -Math.cos(cameraRotation),
          2
        ),
        vec3.fromValues(0, 0, 0),
        vec3.fromValues(0, 0, 1)
      );
      mat4.multiply(cameraMVP, cameraProjection, cameraView);
      updateViewParams(
        renderViewParamsBuffer,
        shadowMVP,
        cameraMVP,
        cameraView
      );
    }
    const swapChainTexture = context.getCurrentTexture();

    renderPassDescriptor.colorAttachments[0].view =
      swapChainTexture.createView();

    const commandEncoder = device.createCommandEncoder();
    // Simulate the particles
    {
      const passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(simulationPipeline);
      passEncoder.setBindGroup(0, computeBindGroup);
      passEncoder.dispatchWorkgroups(Math.ceil(numParticles / 64));
      passEncoder.end();
    }
    // Sort the particles w.r.t the camera
    {
      particlesSorter.encode(commandEncoder);
    }
    // Draw the shadow map
    {
      // Copy shadowViewParamsBuffer -> viewParamsBuffer
      commandEncoder.copyBufferToBuffer(
        shadowViewParamsBuffer,
        0,
        viewParamsBuffer,
        0,
        viewParamsBufferSize
      );
      const passEncoder = commandEncoder.beginRenderPass(shadowPassDescriptor);
      passEncoder.setBindGroup(0, viewParamsBindGroup);
      passEncoder.setBindGroup(1, renderParticlesBindGroup);
      passEncoder.setVertexBuffer(0, quadVertexBuffer);
      // Draw the particles
      passEncoder.setPipeline(particlesShadowRenderPipeline);
      passEncoder.draw(6, numParticles, 0, 0);
      passEncoder.end();
    }
    // Draw the scene
    {
      if (!simulationParams.viewFromLight) {
        // Copy renderViewParamsBuffer -> viewParamsBuffer
        commandEncoder.copyBufferToBuffer(
          renderViewParamsBuffer,
          0,
          viewParamsBuffer,
          0,
          viewParamsBufferSize
        );
      }
      const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
      passEncoder.setBindGroup(0, viewParamsBindGroup);
      passEncoder.setBindGroup(1, shadowBuffersBindGroup);
      passEncoder.setVertexBuffer(0, quadVertexBuffer);
      // Draw the ground plane
      passEncoder.setPipeline(groundRenderPipeline);
      passEncoder.draw(6, 1, 0, 0);
      // Draw the particles
      if (simulationParams.drawParticles) {
        passEncoder.setPipeline(particlesDrawRenderPipeline);
        passEncoder.draw(6, numParticles, 0, 0);
      }
      passEncoder.end();
    }

    device.queue.submit([commandEncoder.finish()]);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
};

const Particles: () => JSX.Element = () =>
  makeSample({
    name: 'Particles',
    description:
      'This example demonstrates rendering of particles simulated with compute shaders.',
    gui: true,
    init,
    sources: [
      {
        name: __filename.substring(__dirname.length + 1),
        contents: __SOURCE__,
      },
      {
        name: './particle.wgsl',
        contents: particleWGSL,
        editable: true,
      },
      {
        name: './probabilityMap.wgsl',
        contents: probabilityMapWGSL,
        editable: true,
      },
    ],
    filename: __filename,
  });

export default Particles;

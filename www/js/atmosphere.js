// OBELISK — final-stage grade: chromatic aberration, film grain, scanline
// breath, vignette, and the ECLIPSE desaturation/inversion.
// One fullscreen pass, negligible cost, does most of the "expensive film" look.
export const AtmosphereShader = {
  name: 'AtmosphereShader',
  uniforms: {
    tDiffuse:   { value: null },
    uTime:      { value: 0 },
    uAberration:{ value: 0.0015 },  // rises with danger and on impacts
    uGrain:     { value: 0.055 },
    uVignette:  { value: 0.85 },
    uEclipse:   { value: 0 },       // 0..1 — drains colour, lifts contrast
    uDanger:    { value: 0 },       // 0..1 — bleeds red into the edges
    uFlash:     { value: 0 },       // 0..1 — full-frame impact bloom
    uPulse:     { value: 0 },       // 0..1 — musical beat throb
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberration, uGrain, uVignette;
    uniform float uEclipse, uDanger, uFlash, uPulse;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;
      vec2 toC = uv - 0.5;
      float r2 = dot(toC, toC);

      // barrel-ish chromatic split, strongest at the edges
      float amt = uAberration * (1.0 + r2 * 3.0) * (1.0 + uPulse * 0.5);
      vec3 col;
      col.r = texture2D(tDiffuse, uv - toC * amt).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + toC * amt).b;

      // ECLIPSE — the world cools and hardens, but the board stays readable:
      // desaturate toward steel-blue only partway, so piece hues survive.
      if (uEclipse > 0.001) {
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 cold = vec3(l * 0.62, l * 0.82, l * 1.30);
        cold = mix(cold, col * vec3(0.55, 0.85, 1.35), 0.45);   // keep some hue
        cold = pow(max(cold, 0.0), vec3(0.88));
        col = mix(col, cold, uEclipse * 0.78);
        // faint horizontal interference, like a held breath
        col += uEclipse * 0.022 * sin(uv.y * 900.0 + uTime * 3.0);
      }

      // danger bleeds in from the corners
      if (uDanger > 0.001) {
        float edge = smoothstep(0.12, 0.62, r2);
        col = mix(col, col * vec3(1.5, 0.42, 0.46), edge * uDanger * 0.85);
      }

      // impact flash
      col += uFlash * (0.6 - r2 * 0.4);

      // vignette
      col *= 1.0 - uVignette * smoothstep(0.18, 0.82, r2);

      // grain, animated
      float g = hash(uv * vec2(1024.0, 1024.0) + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain * (1.0 - 0.5 * uEclipse);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

// HME.js - WebGL effect host
// Creates a WebGL program and applies a fragment shader with
// hue, wave (12 params), swirl (6 params) and an unused shake (6 params).
class HME {
  constructor(opts = {}) {
    this.canvas = opts.canvas || document.createElement('canvas');
    this.video = opts.video || document.createElement('video');
    this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
    if (!this.gl) throw new Error('WebGL not supported');
    this.program = null;
    this.startTime = performance.now();
    this._running = false;

    // default uniforms
    this.hue = 0.0;
    this.waveParams = new Array(12).fill(0.0);
    // set some reasonable defaults (6 amp/freq pairs)
    for (let i=0;i<12;i++) this.waveParams[i] = (i%2===0?0.12:1.0) * (1 + (i/12));

    this.swirl = [0.5,0.5,0.5,2.5,0.5,0.0];
    this.shake = new Array(6).fill(0.0); // unused but present
    this.lastTime = 0;

    // shader sources
    this._vsSource = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main(){
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    this._fsSource = `
      precision highp float;
      varying vec2 v_uv;
      uniform sampler2D u_tex;
      uniform float u_time;
      uniform float u_hue;
      uniform float u_wave[12];
      uniform float u_swirl[6];
      uniform float u_shake[6]; // unused

      // rotate color hue in RGB space
      vec3 hueRotate(vec3 color, float degrees){
        float angle = radians(degrees);
        float s = sin(angle), c = cos(angle);
        mat3 rot = mat3(
          0.299 + 0.701*c + 0.168*s, 0.587-0.587*c+0.330*s, 0.114-0.114*c-0.497*s,
          0.299-0.299*c-0.328*s, 0.587+0.413*c+0.035*s, 0.114-0.114*c+0.292*s,
          0.299-0.3*c+1.25*s, 0.587-0.588*c-1.05*s, 0.114+0.886*c-0.203*s
        );
        return clamp(rot * color, 0.0, 1.0);
      }

      // swirl/twirl
      vec2 swirl(vec2 uv, vec2 center, float radius, float strength){
        vec2 p = uv - center;
        float dist = length(p);
        if (dist < radius){
          float t = (radius - dist) / radius;
          float angle = strength * t * t;
          float s = sin(angle), c = cos(angle);
          mat2 rot = mat2(c, -s, s, c);
          return center + rot * p;
        }
        return uv;
      }

      void main(){
        vec2 uv = v_uv;

        // waves: interpret u_wave as 6 pairs: amp[0..5] = u_wave[0..5] and freq[0..5] = u_wave[6..11]
        float dx = 0.0;
        for(int i=0;i<6;i++){
          float amp = u_wave[i];
          float freq = u_wave[6 + i];
          // vary speed slightly with index
          float phase = u_time * (0.2 + float(i) * 0.08);
          dx += amp * sin((uv.y + uv.x) * freq * 6.28318 + phase);
          // add a second harmonic for complexity:
          dx += 0.5 * amp * sin((uv.y - uv.x) * freq * 12.56636 + phase * 1.3);
        }
        uv.x += dx * 0.02;

        // Swirl: params: cx,cy,radius,strength,speed,extra
        vec2 center = vec2(u_swirl[0], u_swirl[1]);
        float radius = u_swirl[2];
        float strength = u_swirl[3] * (1.0 + 0.1*sin(u_swirl[4]*u_time + u_swirl[5]*3.14));
        uv = swirl(uv, center, radius, strength);

        // sample texture
        vec4 col = texture2D(u_tex, uv);

        // hue rotate
        col.rgb = hueRotate(col.rgb, u_hue);

        gl_FragColor = col;
      }
    `;
  }

  init(){
    const gl = this.gl;
    // compile program
    const vs = this._compile(gl.VERTEX_SHADER, this._vsSource);
    const fs = this._compile(gl.FRAGMENT_SHADER, this._fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'a_pos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + gl.getProgramInfoLog(program));
    }
    this.program = program;

    // full-screen triangle
    const quad = new Float32Array([-1,-1, 3,-1, -1,3]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    gl.useProgram(program);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // create texture
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._tex = tex;

    // uniform locations
    this.u_time = gl.getUniformLocation(program, 'u_time');
    this.u_hue = gl.getUniformLocation(program, 'u_hue');
    this.u_wave = gl.getUniformLocation(program, 'u_wave');
    this.u_swirl = gl.getUniformLocation(program, 'u_swirl');
    this.u_shake = gl.getUniformLocation(program, 'u_shake');
    this.u_texLoc = gl.getUniformLocation(program, 'u_tex');

    // texture unit
    gl.uniform1i(this.u_texLoc, 0);

    // default sizes
    this.resizeCanvas();
    // start rendering loop only when play is pressed; call start() to run
    this._render = this._render.bind(this);
    this._updateVideoTexture = this._updateVideoTexture.bind(this);
  }

  _compile(type, src){
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(s);
      console.error('Shader compile error', err, src);
      throw new Error(err);
    }
    return s;
  }

  resizeCanvas(){
    // keep canvas size consistent with CSS and/or video aspect
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * pixelRatio));
    const h = Math.max(1, Math.floor(rect.height * pixelRatio));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0,0,w,h);
    }
  }

  resizeToVideo(){
    if (!this.video.videoWidth) return;
    const aspect = this.video.videoWidth / this.video.videoHeight;
    const width = Math.min(1280, this.canvas.parentElement.clientWidth || 1280);
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = Math.round(width / aspect) + 'px';
    this.resizeCanvas();
  }

  setHue(deg){
    this.hue = deg;
  }

  setWaveParams(arr){
    // expects length 12
    for(let i=0;i<12;i++) this.waveParams[i] = arr[i] || 0.0;
  }

  setSwirl(arr){
    for(let i=0;i<6;i++) this.swirl[i] = arr[i] || 0.0;
  }

  setShakeParams(arr){
    for(let i=0;i<6;i++) this.shake[i] = arr[i] || 0.0;
  }

  _updateVideoTexture(){
    const gl = this.gl;
    if (!this.video || this.video.readyState < 2) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    try {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
    } catch(e) {
      // cross origin or other issues
      // console.warn('texImage2D failed', e);
    }
  }

  _render(now){
    if (!this._running) return;
    const gl = this.gl;
    this.resizeCanvas();
    const t = (now - this.startTime) / 1000.0;
    gl.useProgram(this.program);
    // update video texture
    this._updateVideoTexture();

    // set uniforms
    gl.uniform1f(this.u_time, t);
    gl.uniform1f(this.u_hue, this.hue);
    gl.uniform1fv(this.u_wave, new Float32Array(this.waveParams));
    gl.uniform1fv(this.u_swirl, new Float32Array(this.swirl));
    gl.uniform1fv(this.u_shake, new Float32Array(this.shake));

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this._raf = requestAnimationFrame(this._render);
  }

  start(){
    if (this._running) return;
    this._running = true;
    this.startTime = performance.now();
    this._raf = requestAnimationFrame(this._render);
  }

  pause(){
    if (!this._running) return;
    this._running = false;
    cancelAnimationFrame(this._raf);
  }
}
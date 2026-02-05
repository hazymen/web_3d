window.addEventListener("DOMContentLoaded", init);

function init() {
    // ウィンドウサイズを取得（レスポンシブ対応）
    let width = window.innerWidth;
    let height = window.innerHeight;

    // === Web Audio API セットアップ ===
    const engineAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    let engineOscillators = []; // 複数の倍音用
    let engineGain = null;
    let engineNoiseGain = null;
    let engineFilter = null;
    let noiseSource = null;
    let enginePanner = null; // 3Dオーディオ用パンナー
    
    // エンジン音の初期化（より現実的）
    function initEngineAudio() {
        // ゲイン（マスターボリューム）
        engineGain = engineAudioContext.createGain();
        engineGain.gain.setValueAtTime(0.08, engineAudioContext.currentTime);
        
        // 3Dパンニング（ステレオ化）
        enginePanner = engineAudioContext.createStereoPanner();
        enginePanner.pan.setValueAtTime(0, engineAudioContext.currentTime);
        
        // フィルター（エンジンの共鳴を表現）
        engineFilter = engineAudioContext.createBiquadFilter();
        engineFilter.type = 'peaking';
        engineFilter.frequency.setValueAtTime(200, engineAudioContext.currentTime);
        engineFilter.gain.setValueAtTime(8, engineAudioContext.currentTime);
        engineFilter.Q.setValueAtTime(1.5, engineAudioContext.currentTime);
        
        // 複数のオシレーター（倍音）
        for (let i = 1; i <= 3; i++) {
            const osc = engineAudioContext.createOscillator();
            osc.type = i === 1 ? 'sine' : 'triangle'; // 基本波はSine、倍音はTriangle
            osc.frequency.setValueAtTime(100 * i, engineAudioContext.currentTime);
            
            const oscGain = engineAudioContext.createGain();
            oscGain.gain.setValueAtTime(0.3 / i, engineAudioContext.currentTime); // 倍音は減衰
            
            osc.connect(oscGain);
            oscGain.connect(engineFilter);
            
            engineOscillators.push(osc);
            osc.start();
        }
        
        // ノイズ生成（エンジンの粗い音、より複雑）
        const bufferSize = engineAudioContext.sampleRate * 0.2;
        const noiseBuffer = engineAudioContext.createBuffer(1, bufferSize, engineAudioContext.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        
        // ブラウン・ノイズのような複雑なノイズ
        let lastValue = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            lastValue = (lastValue + white * 0.1) * 0.95; // 低周波フィルター
            noiseData[i] = lastValue;
        }
        
        noiseSource = engineAudioContext.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;
        
        engineNoiseGain = engineAudioContext.createGain();
        engineNoiseGain.gain.setValueAtTime(0.04, engineAudioContext.currentTime);
        
        // ノイズフィルター（高周波カット）
        const noiseFilter = engineAudioContext.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(3000, engineAudioContext.currentTime);
        
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(engineNoiseGain);
        
        // マスター接続
        engineFilter.connect(engineGain);
        engineNoiseGain.connect(engineGain);
        engineGain.connect(enginePanner);
        enginePanner.connect(engineAudioContext.destination);
        
        noiseSource.start();
    }
    
    // エンジン音更新（RPM、スロットル、距離に応じてピッチと音量を変更）
    function updateEngineAudio(rpm, throttle, carPosition, cameraPosition) {
        if (engineOscillators.length === 0) {
            initEngineAudio();
        }
        
        // 距離を計算
        let distance = 100; // デフォルト（聞こえない距離）
        if (carPosition && cameraPosition) {
            const dx = carPosition.x - cameraPosition.x;
            const dy = carPosition.y - cameraPosition.y;
            const dz = carPosition.z - cameraPosition.z;
            distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        
        // 距離に基づいて音量を計算（10m以内で最大、30m以上で無音）
        const maxDistance = 30;
        const minDistance = 2;
        let distanceVolume = 1.0;
        if (distance > minDistance) {
            distanceVolume = Math.max(0, 1 - (distance - minDistance) / (maxDistance - minDistance));
        }
        
        // RPMからエンジン周波数を計算（4気筒エンジンの点火間隔を想定）
        const baseFrequency = Math.max(20, (rpm / 30)); // 20-233Hz（0-7000RPM）
        
        // 複数のオシレーターをアップデート
        engineOscillators.forEach((osc, index) => {
            const harmonicFrequency = baseFrequency * (index + 1);
            osc.frequency.exponentialRampToValueAtTime(
                Math.max(20, harmonicFrequency),
                engineAudioContext.currentTime + 0.05
            );
        });
        
        // スロットルと距離に応じて音量を調整
        const baseVolume = (0.05 + Math.abs(throttle) * 0.08) * distanceVolume;
        engineGain.gain.linearRampToValueAtTime(baseVolume, engineAudioContext.currentTime + 0.05);
        
        // RPMに応じてノイズレベルを調整（低RPMで粗い音）
        const noiseAmount = (0.04 + (1 - Math.min(1, rpm / 4000)) * 0.06) * distanceVolume;
        engineNoiseGain.gain.linearRampToValueAtTime(noiseAmount, engineAudioContext.currentTime + 0.05);
        
        // フィルター周波数をRPMに応じて動的に変更
        engineFilter.frequency.linearRampToValueAtTime(
            Math.min(500, 150 + rpm / 20),
            engineAudioContext.currentTime + 0.05
        );
        
        // ステレオパンニング（左右の位置に応じて音の位置を変更）
        if (carPosition && cameraPosition) {
            const relativeX = carPosition.x - cameraPosition.x;
            // -1（左）から 1（右）の範囲にクランプ
            const panValue = Math.max(-1, Math.min(1, relativeX / 50));
            enginePanner.pan.linearRampToValueAtTime(panValue, engineAudioContext.currentTime + 0.1);
        }
    }

    // レンダラーを作成（軽量化済み）
    const canvasElement = document.querySelector('#myCanvas');
    const renderer = new THREE.WebGLRenderer({
        antialias: false, // アンチエイリアス無効で軽量化
        canvas: canvasElement,
        powerPreference: 'high-performance' // 高パフォーマンスモード
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // pixelRatioを制限
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // PCF: 影に諧調を付ける（簡易版）
    renderer.toneMapping = THREE.ACESFilmicToneMapping; // 夜景向けトーンマッピング
    renderer.toneMappingExposure = 1.0;

    // シーンを作成
    const scene = new THREE.Scene();

    // === 昼夜フラグ ===
    let isNightMode = false; // デフォルト：昼モード
    
    // === 街モデル管理（統一版） ===
    let cityModel = null; // 高解像度モデル
    let cityModelLow = null; // 低解像度モデル（city_lod.glb）
    let emissiveMeshes = []; // 放射マテリアルを持つメッシュ
    let lodMeshMap = new Map(); // メッシュマッピング: {meshName: {high: mesh, low: mesh}}
    const LOD_DISTANCE = 100; // LOD切り替え距離（m）
    
    // カメラを作成（描画距離を最適化）
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.5, 5000);
    camera.position.set(-10, 1.6, -25); // 一人称視点の高さ
    
    // === Bloom効果（ポストプロセス）のセットアップ ===
    const composer = new THREE.EffectComposer(renderer);
    const renderPass = new THREE.RenderPass(scene, camera);
    composer.addPass(renderPass);
    
    // UnrealBloomPass: 窓の放射マテリアルを光らせる（夜モード用、軽量化版）
    const bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.6,    // strength（光の強さ）→ 1.0から0.6に低下
        0.3,    // radius（光の広がり）→ 0.4から0.3に縮小
        0.98     // threshold（光り始めるしきい値）→ 0.95から0.98に引き上げ（限定的）
    );
    composer.bloomPass = bloomPass; // 後で有効/無効を切り替え用に保存
    // 初期状態：昼モードなので無効

    function setFov(fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
    }
    setFov(60);

    let moveForward = false;
    let moveBackward = false;
    let rotateLeft = false;
    let rotateRight = false;

    let carForward = false;
    let carBackward = false;
    let carLeft = false;
    let carRight = false;
    let carBrake = false; // ブレーキ入力（Shift キー）
    
    let overviewMode = false; // Hキーで俯瞰図モード
    let savedCameraPosition = null;
    let savedCameraQuaternion = null;


    const velocity = 0.1;
    const rotationSpeed = 0.03;

    const clock = new THREE.Clock();
    const targetFPS = 60;
    const frameDuration = 1000 / targetFPS; // 1000ms / 60fps = 約16.67ms
    let lastFrameTime = performance.now();
    let accumulatedTime = 0;
    
    // カメラコントローラーを作成
    /*
    const controls = new THREE.OrbitControls(camera, canvasElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.2;
    */

    // 環境光源を作成（昼モード設定）
    const ambientLight = new THREE.AmbientLight(0xffffff);
    ambientLight.intensity = 0.4;
    ambientLight.position.set(200,200,200)
    scene.add(ambientLight);
    scene.ambientLight = ambientLight; // 昼夜切り替え用

    // 太陽光（DirectionalLight）の追加（昼モード設定）
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2); // 色と強さ
    sunLight.position.set(500, 1000, 500); // 太陽の位置（高い位置に設定）
    sunLight.castShadow = true; // 影を有効化
    sunLight.shadow.mapSize.width = 1024; // 軽量化：4096→1024
    sunLight.shadow.mapSize.height = 1024;
    
    // 影の範囲を広げる
    sunLight.shadow.camera.left = -500;
    sunLight.shadow.camera.right = 500;
    sunLight.shadow.camera.top = 500;
    sunLight.shadow.camera.bottom = -500;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 2000;

    // PCFShadowMap用のバイアス最適化
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.radius = 2; // PCFの範囲（ソフトシャドウの諧調に影響）
    
    scene.add(sunLight);
    scene.sunLight = sunLight; // 昼夜切り替え用
    
    // 夜モード用のライト設定を事前に保存
    const nightAmbientColor = 0x1a1a2e;
    const nightAmbientIntensity = 0.3;
    const nightSunColor = 0x4466aa;
    const nightSunIntensity = 0.4;
   

    // 光源を作成
    const light = new THREE.SpotLight(0xffffff, 400, 100, Math.PI / 4, 1);
    light.intensity = 0.0;
    light.position.set(10, 10, 10);
    light.castShadow = true;
    // scene.add(light);

    const meshFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100, 1, 1), // 分割数を1に
        new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.0 }),
    );
    // 影を受け付ける
    meshFloor.rotation.x = -Math.PI / 2; // 水平にする
    meshFloor.position.set(0, 0, 0);
    // meshFloor.receiveShadow = true;
    scene.add(meshFloor);


    const skyGeometry = new THREE.BoxGeometry(5000, 5000, 5000); // カメラを確実に包括するサイズ
    
    // === 昼間用：雲のテクスチャを生成 ===
    function generateCloudTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 1024; // キューブ用に正方形に
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        
        // より鮮やかな空色グラデーション
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#4BA3E3');   // 上：濃い空色
        gradient.addColorStop(0.5, '#87CEEB'); // 中央：標準的な空色
        gradient.addColorStop(1, '#E0F4FF');   // 下：淡い水色
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 雲を描画（複数レイヤー・複数パターン、正方形キャンバス用） 
        const cloudLayers = [
            { scale: 80, y: 150, alpha: 0.2, amplitude: 25 },
            { scale: 120, y: 350, alpha: 0.15, amplitude: 35 },
            { scale: 160, y: 550, alpha: 0.12, amplitude: 40 },
            { scale: 200, y: 750, alpha: 0.1, amplitude: 50 }
        ];
        
        // 複数レイヤーで雲を生成
        cloudLayers.forEach((layer, layerIdx) => {
            ctx.fillStyle = `rgba(255, 255, 255, ${layer.alpha})`;
            ctx.strokeStyle = `rgba(255, 255, 255, ${layer.alpha * 0.8})`;
            ctx.lineWidth = 2;
            
            // 複数のクラウドパターンを描画（間隔を広げて密度を低下）
            for (let patternX = 0; patternX < canvas.width; patternX += layer.scale * 4) {
                ctx.beginPath();
                for (let x = patternX; x < patternX + layer.scale * 2 && x < canvas.width; x += layer.scale / 4) {
                    const baseY = layer.y + layerIdx * 50;
                    const y = baseY + 
                             Math.sin(x / layer.scale + layerIdx) * layer.amplitude +
                             Math.sin(x / (layer.scale * 0.5) + layerIdx * 2) * (layer.amplitude * 0.6) +
                             Math.sin(x / (layer.scale * 1.5) + layerIdx * 3) * (layer.amplitude * 0.4);
                    
                    if (x === patternX) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.lineTo(patternX + layer.scale * 2, 0);
                ctx.lineTo(patternX, 0);
                ctx.closePath();
                ctx.fill();
            }
        });
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.wrapS = THREE.RepeatWrapping; // 水平方向にリピート
        texture.wrapT = THREE.ClampToEdgeWrapping; // 垂直方向はエッジにクリップ
        return texture;
    }
    
    const cloudTexture = generateCloudTexture();
    // テクスチャ繰り返しを調整（キューブマップ用）
    cloudTexture.repeat.set(2, 2); // 各面で2×2の繰り返し
    cloudTexture.offset.set(0, 0);
    
    // キューブの6面用マテリアル配列（昼モード）
    const skyMaterialDay = [];
    for (let i = 0; i < 6; i++) {
        const textureForMat = cloudTexture; // 同じテクスチャを参照
        const mat = new THREE.MeshBasicMaterial({ 
            map: textureForMat,
            depthWrite: false, // 深度テストを無効化（背景として機能）
            depthTest: false, // 深度テスト自体を無効化
            side: THREE.BackSide // キューブ内側からの表示
        });
        skyMaterialDay.push(mat);
    }
    
    // キューブの6面用マテリアル配列（夜モード）
    const skyMaterialNight = [];
    for (let i = 0; i < 6; i++) {
        const mat = new THREE.MeshBasicMaterial({ 
            color: 0x0a0a1a,
            depthWrite: false, // 深度テストを無効化（背景として機能）
            depthTest: false, // 深度テスト自体を無効化
            side: THREE.BackSide // キューブ内側からの表示
        });
        skyMaterialNight.push(mat);
    }
    
    const sky = new THREE.Mesh(skyGeometry, skyMaterialDay); // 初期状態：昼モード
    scene.add(sky);
    scene.sky = sky; // 昼夜切り替え用
    scene.sky.renderOrder = -1000; // 最初に描画（背景として機能）
    scene.skyMaterialDay = skyMaterialDay;
    scene.skyMaterialNight = skyMaterialNight;
    scene.nightSkyColor = 0x1a1a2e; // 夜空の色を保存
    scene.daySkyColor = 0x87ceeb; // 昼空の色を保存

    // === 夜空の星を追加 ===
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 1000; // 星の数
    const starPositions = new Float32Array(starCount * 3);
    
    for (let i = 0; i < starCount * 3; i += 3) {
        // ランダムな球面座標上に星を配置
        const theta = Math.random() * Math.PI * 2; // 方位角
        const phi = Math.acos(Math.random() * 2 - 1); // 仰角
        const radius = 2400; // スカイボックス内側（5000×5000×5000の内側）
        
        starPositions[i] = radius * Math.sin(phi) * Math.cos(theta);
        starPositions[i + 1] = radius * Math.cos(phi);
        starPositions[i + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    
    const starMaterial = new THREE.PointsMaterial({
        color: 0xffffff, // 白色
        size: 8.0, // サイズを大きくして見やすく
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9
    });
    
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);
    scene.stars = stars; // 昼夜切り替え用
    stars.visible = false; // 初期状態：昼なので非表示

    let isJumping = false;
    let velocityY = 0;
    const gravity = -20.0;        // 重力加速度（m/s²）
    const jumpVelocity = 6.0;     // ジャンプ初速度（m/s）
    const groundHeight = 1.6;

    // ===== プレイヤースポーン設定 =====
    const spawnPosition = new THREE.Vector3(-10, 1.6, -25); // スポーン位置
    const spawnRotation = {
        pitch: 0,      // 上下の角度（ラジアン）：負=上向き、正=下向き
        yaw: Math.PI-0.6         // 左右の角度（ラジアン）：0=Z-方向（前）、Math.PI/2=X+方向（右）
    };
    // =====================================

    // ===== 複数車両管理システム =====
    // 車データ構造（複数台の車を同時に管理）
    let cars = []; // 全車両を保存する配列
    let activeCarIndex = -1; // 現在乗車している車のインデックス（-1 = 乗車なし）
    
    // ===== 物理オブジェクト管理システム（120.glb用） =====
    let physicsObjects = []; // 物理演算対象のオブジェクト配列
    
    // Car オブジェクトの構造
    // {
    //   object: GLTFシーン,
    //   mixer: アニメーションミキサー,
    //   colliderObject: 当たり判定OBJオブジェクト,
    //   colliderMeshes: コライダーのメッシュ配列,
    //   loaded: 読み込み完了フラグ,
    //   colliderLoaded: コライダー読み込み完了フラグ,
    //   state: 車の物理状態,
    //   userData: ホイール参照など
    // }

    // 操作モード（乗車状態）フラグ
    let isCarMode = false;

    // 現在乗車中の車への便利なアクセス
    function getActiveCar() {
        if (activeCarIndex >= 0 && activeCarIndex < cars.length) {
            return cars[activeCarIndex];
        }
        return null;
    }

    // ===== 車の物理定数（全車両共通） =====
    // 複数の車モデルを実装する際の標準構造
    // 注: すべての可動部品を含むわけではない。モデルに存在する部品のみ実装する。
    // frame
    //   ├─ エンジンやインテリア、その他部品（不可動部品）
    //   └─ body
    //       ├─ door_L（存在する場合）
    //       ├─ door_R（存在する場合）
    //       ├─ hood（存在する場合）
    //       ├─ trunk（存在する場合）
    //       └─ そのほか部品（不可動部品）
    // wheel_FL
    // wheel_FR
    // wheel_RL
    // wheel_RR
    // ===================================

    // 車の物理定数（全車両共通）
    const carMaxSpeed = 2000;      // 最高速度[m/s]
    const carAccel = 22;          // 加速度[m/s^2]
    const carFriction = 0.98;    // 摩擦係数
    const carSteerSpeed = 0.8;  // ハンドル速度
    const carMaxSteer = 0.07;   // 最大ハンドル角

    const enterCarDistance = 3.0;  // 乗車可能距離
    let canEnterCar = false;       // 乗車可能フラグ
    let nearestCarIndex = -1;      // 最も近い車のインデックス
    let carViewMode = 1;           // 1:三人称, 2:車内視点
    let cameraFollowPos = new THREE.Vector3(0, 3, -6); // カメラ追従位置
    let carStopped = false;
    let carStopTime = 0;
    window.carSlipAngle = 0;

    // NPCキャラクター管理配列
    const npcs = [];

    // 銃と弾の関連変数
    let gunObject = null;
    let gunLoaded = false;
    const bullets = [];
    const bulletTrails = [];
    const impactEffects = []; // 着弾エフェクト用配列
    const muzzleFlashEffects = []; // マズルフラッシュ用配列
    const impactEffectObjects = []; // レイキャスト除外用：エフェクトオブジェクト参照配列
    const bulletSpeed = 0.5;
    const bulletGravity = 0.003;
    const bulletTrailDuration = 300; // ミリ秒
    const gunMuzzleOffset = new THREE.Vector3(0.35, -0.2, -1.5); // 銃口のカメラ座標オフセット
    
    // 銃の位置設定
    const gunPositionNormal = new THREE.Vector3(0.4, -0.3, -0.85); // 通常時の銃のオフセット
    const gunPositionRunning = new THREE.Vector3(-0.1, -0.35, -0.6); // 走行時の銃のオフセット
    
    // 射撃状態フラグ
    let isShooting = false; // 左クリック長押し中かどうか
    const shootingRateLimit = 100; // ミリ秒（0.1秒ごとに連射）
    let lastShotTime = 0;

    // ===== Web Audio API セットアップ（ブラウザ互換性のための初期化） =====
    let audioContext = null;
    function getAudioContext() {
        if (!audioContext) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioContext = new AudioContextClass();
            }
        }
        return audioContext;
    }
    // =====================

    // ===== 足音SE設定 =====
    const stepSoundFiles = [
        'se/step1.mp3',
        'se/step2.mp3',
        'se/step3.mp3'
    ];
    const stepSoundInterval = 0.4; // 秒（走行時の足音間隔）
    let lastStepTime = 0; // 最後に足音を再生した時刻
    const stepAudioBuffers = []; // 読み込み済みAudioBuffer配列

    // 足音ファイルを非同期で読み込む
    async function loadStepSounds() {
        for (const file of stepSoundFiles) {
            try {
                const response = await fetch(file);
                const arrayBuffer = await response.arrayBuffer();
                const audioContext = getAudioContext();
                if (audioContext) {
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    stepAudioBuffers.push(audioBuffer);
                }
            } catch (error) {
                console.warn(`Failed to load sound: ${file}`, error);
            }
        }
    }
    loadStepSounds();
    // ====================

    // ===== 銃声SE設定 =====
    const shotSoundFiles = [
        'se/shot1.mp3',
        'se/shot2.mp3',
        'se/shot3.mp3'
    ];
    const shotAudioBuffers = []; // 読み込み済みAudioBuffer配列

    // 銃声ファイルを非同期で読み込む
    async function loadShotSounds() {
        for (const file of shotSoundFiles) {
            try {
                const response = await fetch(file);
                const arrayBuffer = await response.arrayBuffer();
                const audioContext = getAudioContext();
                if (audioContext) {
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    shotAudioBuffers.push(audioBuffer);
                }
            } catch (error) {
                console.warn(`Failed to load sound: ${file}`, error);
            }
        }
    }
    loadShotSounds();
    // ====================

    // 音声再生関数（AudioBuffer用）
    function playAudio(audioBuffer, volume = 1.0) {
        const audioContext = getAudioContext();
        if (!audioContext || !audioBuffer) return;

        try {
            const source = audioContext.createBufferSource();
            const gainNode = audioContext.createGain();
            
            source.buffer = audioBuffer;
            gainNode.gain.value = volume;
            
            source.connect(gainNode);
            gainNode.connect(audioContext.destination);
            source.start(0);
        } catch (error) {
            console.warn('Error playing audio:', error);
        }
    }

    // 3Dモデルの読み込み
    const objLoader = new THREE.OBJLoader();
    function loadOBJModel(modelName, position) {
        const objLoader = new THREE.OBJLoader();
        objLoader.load(`models/${modelName}`, function(object) {
            object.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            object.position.set(position.x, position.y, position.z);
            scene.add(object);
        });
    }

    const cameraRadius = 0.3;

    const mixers = [];
    const collisionMeshes = [];
    // 3Dモデルの読み込み（GLB/GLTF）
    const gltfLoader = new THREE.GLTFLoader();
    function loadGLBModel(modelName, position) {
        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.load(`models/${modelName}`, function(gltf) {
            gltf.scene.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    // 衝突判定用に配列へ追加
                    collisionMeshes.push(child);
                }
            });
            gltf.scene.position.set(position.x, position.y, position.z);
            scene.add(gltf.scene);
            gltf.scene.scale.set(1, 1, 1);

            // アニメーションがあれば再生
            if (gltf.animations && gltf.animations.length > 0) {
                const mixer = new THREE.AnimationMixer(gltf.scene);
                gltf.animations.forEach((clip) => {
                    mixer.clipAction(clip).play();
                });
                mixers.push(mixer);
            }
        });
    }

    // 物理演算対応の読み込み関数（120.glb用）
    function loadPhysicsModel(modelName, position, colliderName, mass = 50) {
        // GLBとコライダーを両方含める親オブジェクトを作成
        const parentObject = new THREE.Group();
        parentObject.position.set(position.x, position.y, position.z);
        scene.add(parentObject);

        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.load(`models/${modelName}`, function(gltf) {
            // ビジュアルメッシュをセットアップ
            gltf.scene.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            // GLBを親オブジェクトの子として追加
            gltf.scene.position.set(0, 0, 0);
            parentObject.add(gltf.scene);
            gltf.scene.scale.set(1, 1, 1);

            // 物理状態を初期化（親オブジェクトを参照）
            const physicsData = {
                object: parentObject,
                velocity: new THREE.Vector3(0, 0, 0),
                angularVelocity: new THREE.Vector3(0, 0, 0),
                mass: mass, // kg（指定された質量を使用）
                gravity: -9.81, // m/s^2
                friction: 0.98, // 空気抵抗＋地面との摩擦
                collisionMeshes: [],
                isActive: false, // 衝突中かどうか
                isGrounded: false, // 接地フラグ
                groundFrameCount: 0, // 接地フレームカウンター
                spawnFrameCount: 0, // 生成後のフレームカウンター（地面判定遅延用）
                isSpawning: true, // 生成直後フラグ
                needsInitialPositioning: true // 初期位置設定フラグ
            };

            // コライダーがある場合は読み込む
            if (colliderName) {
                loadPhysicsCollider(colliderName, physicsData, parentObject);
            } else {
                // コライダーがない場合はGLBのメッシュを使用（後方互換性）
                gltf.scene.traverse(function(child) {
                    if (child.isMesh) {
                        physicsData.collisionMeshes.push(child);
                    }
                });
                physicsObjects.push(physicsData);
                // 物理配列に追加後、初期位置設定をマーク
                physicsData.needsInitialPositioning = true;
            }
        });
    }

    // コライダーメッシュからバウンディングボックスを計算（回転に影響されない）
    function getColliderBoundingBox(colliderMeshes) {
        const bbox = new THREE.Box3();
        for (const mesh of colliderMeshes) {
            if (mesh.geometry && !mesh.geometry.boundingBox) {
                mesh.geometry.computeBoundingBox();
            }
            if (mesh.geometry && mesh.geometry.boundingBox) {
                const localBbox = mesh.geometry.boundingBox.clone();
                // ジオメトリのローカルバウンディングボックスをワールド座標に変換
                localBbox.applyMatrix4(mesh.matrixWorld);
                bbox.union(localBbox);
            }
        }
        return bbox;
    }
    
    // 物理演算用コライダー読み込み関数
    function loadPhysicsCollider(colliderName, physicsData, parentObject) {
        const objLoader = new THREE.OBJLoader();
        objLoader.load(`models/${colliderName}`, function(object) {
            // コライダーを親オブジェクトの子として追加
            object.position.set(0, 0, 0);
            object.traverse(function(child) {
                if (child.isMesh) {
                    // 物理コライダーを別配列に保存（自身の検出時に除外するため）
                    if (!physicsData.colliderMeshes) {
                        physicsData.colliderMeshes = [];
                    }
                    physicsData.colliderMeshes.push(child);
                    
                    // 表示用：ワイヤーフレーム＆半透明で視認性を確保
                    const wireframeMaterial = new THREE.MeshStandardMaterial({
                        color: 0x00ff00,
                        wireframe: true,
                        transparent: true,
                        opacity: 0.5,
                        emissive: 0x00aa00
                    });
                    child.material = wireframeMaterial;
                    child.visible = false; // コライダーを非表示
                    // ※ groundCollisionMeshesには追加しない（地面判定の対象外）
                }
            });
            parentObject.add(object);
            // コライダー読み込み完了後に物理データを追加
            physicsObjects.push(physicsData);
        });
    }

    // gt86.glb専用の読み込み・配置関数
    function loadCarModel(modelName, position) {
        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.load(`models/${modelName}`, function(gltf) {
            gltf.scene.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            gltf.scene.position.set(position.x, position.y, position.z);
            gltf.scene.scale.set(1, 1, 1);
            scene.add(gltf.scene);

            // 新しい車オブジェクトを作成
            const carData = {
                object: gltf.scene,
                mixer: null,
                colliderObject: null,
                colliderMeshes: [],
                loaded: true,
                colliderLoaded: false,
                state: null,
                userData: {},
                headlights: [] // ヘッドライトを記録
            };

            // === モデル内のスポットライト（ヘッドライト）を探す ===
            gltf.scene.traverse(function(child) {
                if (child.isLight && (child instanceof THREE.SpotLight)) {
                    // ターゲットを車オブジェクトに追加（車の回転に追従）
                    child.target.position.set(0, 0, -30.0); // 相対座標で前方を指す
                    gltf.scene.add(child.target);
                    
                    // スポットライトの投光パラメータ最適化
                    child.intensity = 1.0; // ライト強度を確保
                    child.distance = 150; // 投光距離を150に設定
                    child.angle = Math.PI / 6; // ビーム角（約30度）
                    child.penumbra = 0.5; // ビームの柔らかさ
                    child.decay = 2.0; // 距離による減衰
                    
                    carData.headlights.push(child);
                    child.visible = false; // 初期状態：昼なので無効
                }
            });
            
            if (carData.headlights.length > 0) {
                console.log(`💡 ${modelName}のスポットライト${carData.headlights.length}個を検出`);
            }

            // アニメーションがあれば再生
            if (gltf.animations && gltf.animations.length > 0) {
                carData.mixer = new THREE.AnimationMixer(gltf.scene);
                gltf.animations.forEach((clip) => {
                    carData.mixer.clipAction(clip).play();
                });
            }

            cars.push(carData);
        });
    }

    // NPCキャラクター読み込み関数（物理モデルベース）
    function loadNPCModel(modelName, position) {
        // 親オブジェクトを作成（物理モデルと同じ方式）
        const parentObject = new THREE.Group();
        parentObject.position.set(position.x, position.y, position.z);
        scene.add(parentObject);

        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.load(`models/${modelName}`, function(gltf) {
            gltf.scene.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            // GLBを親オブジェクトの子として追加（物理モデルと同じ方式）
            gltf.scene.position.set(0, 0, 0);
            parentObject.add(gltf.scene);
            gltf.scene.scale.set(1, 1, 1);

            // NPCオブジェクトを作成（物理モデルの機能を完全に含む）
            const npcData = {
                object: parentObject,
                visualObject: gltf.scene,
                mixer: null,
                loaded: true,
                colliderMeshes: [], // コライダーメッシュ配列
                // 物理演算パラメータ（物理モデルと同一）
                velocity: new THREE.Vector3(0, 0, 0),
                angularVelocity: new THREE.Vector3(0, 0, 0),
                mass: 70, // kg（成人男性の平均体重）
                gravity: -9.81, // m/s^2
                friction: 0.98, // 空気抵抗＋地面との摩擦
                isActive: false, // 衝突中かどうか
                isGrounded: false, // 接地フラグ
                groundFrameCount: 0, // 接地フレームカウンター
                spawnFrameCount: 0, // 生成後のフレームカウンター
                isSpawning: true, // 生成直後フラグ
                needsInitialPositioning: true, // 初期位置設定フラグ
                boundingBox: null,
                // NPC専用パラメータ
                state: 'walking', // 'walking', 'knocked_down', 'recovering'
                walkDirection: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
                walkSpeed: 1.2, // 歩行速度（m/s）
                walkTimer: 0,
                walkChangeInterval: 5.0, // 方向変更間隔（秒）
                // 起き上がり関連
                staticTimer: 0, // 静止判定タイマー（秒）
                staticThreshold: 0.5, // 静止判定の速度閾値（m/s）
                recoverDelay: 1.0, // 起き上がり遅延（秒）
                recoverTime: 0,
                // 保存用の初期回転（直立状態）
                initialQuaternion: new THREE.Quaternion(0, 0, 0, 1)
            };

            // アニメーションがあれば取得
            if (gltf.animations && gltf.animations.length > 0) {
                npcData.mixer = new THREE.AnimationMixer(gltf.scene);
                npcData.walkAction = npcData.mixer.clipAction(gltf.animations[0]);
                npcData.knockDownAction = gltf.animations.length > 1 ? npcData.mixer.clipAction(gltf.animations[1]) : null;
                npcData.walkAction.play();
            }

            npcs.push(npcData);
            
            // コライダーを読み込む（120_collider.objを使用）
            loadNPCCollider('120_collider.obj', npcData, parentObject);
        });
    }
    
    // NPC用コライダー読み込み関数（物理モデルと同じ方式）
    function loadNPCCollider(colliderName, npcData, parentObject) {
        const objLoader = new THREE.OBJLoader();
        
        objLoader.load(
            `models/${colliderName}`,
            function(object) {
                // コライダーを親オブジェクトの子として追加
                object.position.set(0, 0, 0);
                object.traverse(function(child) {
                    if (child.isMesh) {
                        // NPCコライダーを別配列に保存
                        npcData.colliderMeshes.push(child);
                        
                        // 表示用：ワイヤーフレーム＆半透明で視認性を確保
                        const wireframeMaterial = new THREE.MeshStandardMaterial({
                            color: 0x0000ff,
                            wireframe: true,
                            transparent: true,
                            opacity: 0.3,
                            emissive: 0x0000aa
                        });
                        child.material = wireframeMaterial;
                        child.visible = false; // コライダーを非表示
                    }
                });
                parentObject.add(object);
                // console.log('[NPC] Collider loaded:', colliderName);
            },
            undefined,
            function(error) {
                // コライダー読み込みエラー時はログのみ出力（NPCは動作継続）
                console.warn('[NPC] Collider load error:', colliderName, error);
            }
        );
    }

    // 車の当たり判定用OBJモデルを読み込む関数
    function loadCarColliderOBJ(objName, carIndex, position, scale = {x:1, y:1, z:1}, offset = {x:0, y:0, z:0}) {
        const objLoader = new THREE.OBJLoader();
        objLoader.load(`models/${objName}`, function(object) {
            const colliderMeshes = [];
            let geometryCenter = new THREE.Vector3();
            let meshCount = 0;
            
            object.traverse(function(child) {
                if (child.isMesh) {
                    // コライダーメッシュの表示用マテリアル（半透明の緑）
                    child.material = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.3, visible: true, wireframe: false });
                    // 車固有のメッシュ配列にのみ追加（collisionMeshesには追加しない）
                    colliderMeshes.push(child); // 車固有のメッシュ配列にのみ追加
                    // boundingBoxを明示的に計算
                    if (!child.geometry.boundingBox) {
                        child.geometry.computeBoundingBox();
                    }
                    
                    // ジオメトリの中心を計算（複数メッシュがある場合の平均）
                    const bbox = child.geometry.boundingBox;
                    const meshCenter = new THREE.Vector3();
                    bbox.getCenter(meshCenter);
                    geometryCenter.add(meshCenter);
                    meshCount++;
                    
                    // ワイヤーフレームを追加（表示）
                    const wireframe = new THREE.LineSegments(
                        new THREE.WireframeGeometry(child.geometry),
                        new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 })
                    );
                    wireframe.position.copy(child.position);
                    wireframe.rotation.copy(child.rotation);
                    wireframe.scale.copy(child.scale);
                    wireframe.visible = true; // ワイヤーフレームを表示
                    child.add(wireframe);
                    child.visible = false; // メッシュを表示（デバッグ用）
                }
            });
            
            // 複数メッシュがある場合は平均を取る
            if (meshCount > 0) {
                geometryCenter.divideScalar(meshCount);
                // デバッグログ削除（軽量化）
                // console.log(`[${objName}] Geometry Center: ...`);
            }
            
            // 対応する車データを更新
            if (carIndex >= 0 && carIndex < cars.length && cars[carIndex].object) {
                // 親オブジェクトが存在する場合は子要素として追加
                // ジオメトリの中心をキャンセルして、モデルの原点に合わせる
                const finalOffset = {
                    x: offset.x - geometryCenter.x,
                    y: offset.y - geometryCenter.y,
                    z: offset.z - geometryCenter.z
                };
                
                object.position.set(finalOffset.x, finalOffset.y, finalOffset.z);
                object.scale.set(scale.x, scale.y, scale.z);
                object.rotation.set(0, 0, 0);
                
                cars[carIndex].object.add(object);
                cars[carIndex].colliderObject = object;
                cars[carIndex].colliderMeshes = colliderMeshes;
                cars[carIndex].colliderLoaded = true;
                
                // console.log(`[${objName}] Final Offset Applied: ...`);
            } else {
                // 親がまだ追加されていない場合は後で追加するまで待機
                // 最大3秒間、500ms毎に親の追加を確認
                let attempts = 0;
                const attachCollider = setInterval(() => {
                    attempts++;
                    if (carIndex >= 0 && carIndex < cars.length && cars[carIndex].object) {
                        // 親が追加されたので、子要素として追加
                        const finalOffset = {
                            x: offset.x - geometryCenter.x,
                            y: offset.y - geometryCenter.y,
                            z: offset.z - geometryCenter.z
                        };
                        
                        object.position.set(finalOffset.x, finalOffset.y, finalOffset.z);
                        object.scale.set(scale.x, scale.y, scale.z);
                        object.rotation.set(0, 0, 0);
                        
                        cars[carIndex].object.add(object);
                        cars[carIndex].colliderObject = object;
                        cars[carIndex].colliderMeshes = colliderMeshes;
                        cars[carIndex].colliderLoaded = true;
                        clearInterval(attachCollider);
                    } else if (attempts >= 6) {
                        // タイムアウト：親が見つからない場合はシーンに直接追加
                        object.position.set(position.x, position.y, position.z);
                        object.scale.set(scale.x, scale.y, scale.z);
                        scene.add(object);
                        clearInterval(attachCollider);
                    }
                }, 500);
            }
        });
    }
    

    // 車をロード時に地形の高さに基づいて配置する関数
    function positionCarOnGround(carObject, x, z) {
        // X, Z座標から下向きにレイキャストして地面を検出
        const rayOrigin = new THREE.Vector3(x, 10, z); // 上方から下向きに検査
        const downDir = new THREE.Vector3(0, -1, 0);
        const raycaster = new THREE.Raycaster(rayOrigin, downDir, 0, 20.0);
        
        let groundY = 0; // デフォルト値
        if (groundCollisionMeshes.length > 0) {
            const intersects = raycaster.intersectObjects(groundCollisionMeshes, true);
            if (intersects.length > 0) {
                groundY = intersects[0].point.y + 0.5; // 車の底から0.5上に配置
            }
        }
        
        // 車をその地面の上に配置
        carObject.position.y = groundY;
    }

    // loadOBJModel('ak47.obj', { x: 0, y: 1, z: 0 });
    loadPhysicsModel('120.glb', { x: 3, y: 2, z: 0 }, '120_collider.obj', 50); // 質量50kg

    loadGLBModel("120.glb", {x:0,y:0,z:90});
    loadGLBModel("119.glb", {x:3,y:0,z:96});
    
    // NPCキャラクターを読み込む
    loadNPCModel('121.glb', { x: 3, y: 0, z: -5 });
    loadNPCModel('121.glb', { x: 3, y: 0, z: 10 });
    loadNPCModel('121.glb', { x: -3, y: 0, z: 14 });
    loadNPCModel('121.glb', { x: -27, y: 0, z: 42 });
    loadNPCModel('121.glb', { x: -8, y: 0, z: 83 });
    loadNPCModel('121.glb', { x: -35, y: 0, z: -58 });
    
    // 複数の車を読み込む
    loadCarModel('gt86.glb', { x: -13, y: 0, z: -2});
    // オフセットを調整（モデルの原点ズレを補正：自動計算）
    loadCarColliderOBJ('gt86_collider.obj', 0, { x: -13, y: 0, z: -2 }, {x:1, y:1, z:1}, { x: 0, y: -1.02, z: -0.17 });
    // 車を地形に配置（少し遅延させて地形メッシュが準備できるのを待つ）
    setTimeout(() => {
        if (cars.length > 0 && cars[0].object) {
            positionCarOnGround(cars[0].object, -13, -2);
        }
    }, 500);

    loadCarModel('s13.glb', { x: -23, y: 0, z: -2 });
    // オフセットを調整（モデルの原点ズレを補正：自動計算）
    loadCarColliderOBJ('s13_collider.obj', 1, { x: -23, y: 0, z: -2 }, {x:1, y:1, z:1}, { x: 0.08, y: -1.02, z: -0.07 });
    // 車を地形に配置（少し遅延させて地形メッシュが準備できるのを待つ）
    setTimeout(() => {
        if (cars.length > 1 && cars[1].object) {
            positionCarOnGround(cars[1].object, -23, -2);
        }
    }, 500);

    // 銃モデルを読み込む関数
    function loadGunModel(modelName) {
        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.load(`models/${modelName}`, function(gltf) {
            gunObject = gltf.scene;
            gunObject.rotation.order = 'YXZ'; // 回転順序を固定
            
            // 銃のすべてのメッシュにライティングを適用
            gunObject.traverse(function(child) {
                if (child.isMesh) {
                    // 既存のマテリアルの基本設定を保持して、標準マテリアルに変更
                    const originalMaterial = child.material;
                    const baseColor = originalMaterial.color ? originalMaterial.color : new THREE.Color(0x888888);
                    
                    child.material = new THREE.MeshStandardMaterial({
                        color: baseColor,
                        emissive: new THREE.Color(0x111111), // 自発光を低くして明度を調整
                        metalness: 0.5,
                        roughness: 0.5,
                        side: THREE.FrontSide
                    });
                    
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            
            gunLoaded = true;
        });
    }
    
    // 銃を読み込み
    loadGunModel('vandal.glb');

    // const cityCollisionMeshes = []; // city_collider.obj専用の当たり判定用配列（無効化）
    const cityCollisionMeshes = []; // 衝突判定を無効化するため、空配列のままにする
    const groundCollisionMeshes = []; // city_ground.glb用地面判定配列（坂道対応）

    // city_collider.objを読み込み、当たり判定用にする関数（無効化）
    // function loadCityColliderOBJ(objName, position, scale = {x:1, y:1, z:1}) {
    //     // 無効化
    // }

    // === 統一された街モデル読み込み関数（LOD対応） ===
    function loadCityModel() {
        const gltfLoader = new THREE.GLTFLoader();
        
        // === 高解像度版（city3.glb）を読み込み ===
        gltfLoader.load('models/city3.glb', function(gltf) {
            let meshCount = 0;
            emissiveMeshes = []; // グローバル配列を初期化
            
            gltf.scene.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.frustumCulled = true;
                    child.userData.isHighRes = true; // 高解像度フラグ
                    cityCollisionMeshes.push(child);
                    meshCount++;
                    
                    // === 地面・道路マテリアルの光受信を最適化 ===
                    const meshName = child.name.toLowerCase();
                    if (meshName.includes('ground') || meshName.includes('road') || meshName.includes('floor') || meshName.includes('pavement')) {
                        // 地面・道路のマテリアルを改善
                        if (child.material) {
                            // MeshBasicMaterialなら光に応答するMeshStandardMaterialに変更
                            if (child.material.isMeshBasicMaterial) {
                                const oldMat = child.material;
                                const newMat = new THREE.MeshStandardMaterial({
                                    color: oldMat.color.getHex(),
                                    map: oldMat.map,
                                    roughness: 0.8, // 道路の粗さ
                                    metalness: 0.0,
                                    side: oldMat.side
                                });
                                child.material = newMat;
                            } else if (child.material.isMeshStandardMaterial) {
                                // MeshStandardMaterialなら光受信を強化
                                child.material.roughness = Math.max(0.6, child.material.roughness || 0.8);
                                child.material.metalness = Math.min(0.1, child.material.metalness || 0.0);
                            }
                            child.material.needsUpdate = true;
                        }
                    }
                    
                    // === 放射マテリアルを記録（昼夜切り替え用） ===
                    if (child.material && child.material.emissive) {
                        const hasEmissive = child.material.emissive.r > 0 || child.material.emissive.g > 0 || child.material.emissive.b > 0;
                        if (hasEmissive) {
                            // マテリアルを複製して独立化
                            const mat = child.material.clone();
                            child.material = mat;
                            
                            emissiveMeshes.push({
                                mesh: child,
                                originalEmissive: child.material.emissive.clone(),
                                originalIntensity: child.material.emissiveIntensity || 1.0
                            });
                        }
                    }
                    
                    // === LODマッピング用に高解像度版を記録 ===
                    const meshName_clean = child.name.toLowerCase();
                    if (!meshName_clean.includes('road')) { // road を除外
                        if (!lodMeshMap.has(meshName_clean)) {
                            lodMeshMap.set(meshName_clean, {});
                        }
                        lodMeshMap.get(meshName_clean).high = child;
                    }
                }
            });
            
            gltf.scene.position.set(0, 0.01, 0);
            gltf.scene.scale.set(1, 1, 1);
            scene.add(gltf.scene);
            cityModel = gltf.scene;
            cityModel.emissiveLights = []; // ライト配列を初期化
            
            // === 読み込み時に放射を昼間用に初期化 ===
            emissiveMeshes.forEach(item => {
                const mat = item.mesh.material;
                if (mat) {
                    // emissiveを完全に消す（黒）、強度を0に（昼間設定）
                    mat.emissive.setHex(0x000000);
                    mat.emissiveIntensity = 0.0;
                    // 窓色を空色に設定
                    mat.color.setHex(0x87ceeb);
                    mat.needsUpdate = true;
                }
            });
            
            console.log(`✅ 街モデル読み込み完了: ${meshCount}個のメッシュ, ${emissiveMeshes.length}個が放射マテリアル`);
            
            // === 高解像度メッシュをvisible=trueに明示的に設定 ===
            let highVisibleSet = 0;
            gltf.scene.traverse(function(child) {
                if (child.isMesh) {
                    if (child.visible !== true) {
                        child.visible = true;
                    }
                    highVisibleSet++;
                }
            });
            console.log(`📌 高解像度メッシュ: ${highVisibleSet}個を表示有効に設定`);
        }, undefined, function(error) {
            console.error('❌ 街モデル読み込みエラー:', error);
        });
        
        // === 低解像度版（city_lod.glb）を読み込み ===
        gltfLoader.load('models/city_lod.glb', function(gltf) {
            let lodMeshCount = 0;
            
            // === デバッグ用：city_lod.glbのメッシュ名を出力 ===
            console.log('📋 city_lod.glbのメッシュ一覧（すべて）：');
            gltf.scene.traverse(function(child) {
                if (child.isMesh) {
                    console.log(`  - ${child.name} → ${child.name.toLowerCase()}`);
                }
            });
            
            gltf.scene.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.frustumCulled = true;
                    child.userData.isHighRes = false; // 低解像度フラグ
                    child.visible = false; // 初期状態では非表示
                    
                    // === LODマッピング用に低解像度版を記録 ===
                    const meshName_clean = child.name.toLowerCase();
                    if (!meshName_clean.includes('road')) { // road を除外
                        if (!lodMeshMap.has(meshName_clean)) {
                            lodMeshMap.set(meshName_clean, {});
                        }
                        lodMeshMap.get(meshName_clean).low = child;
                    }
                    lodMeshCount++;
                }
            });
            
            gltf.scene.position.set(0, 0.01, 0);
            gltf.scene.scale.set(1, 1, 1);
            scene.add(gltf.scene);
            cityModelLow = gltf.scene;
            
            // === 低解像度メッシュをvisible=falseに明示的に設定 ===
            let lowHiddenSet = 0;
            gltf.scene.traverse(function(child) {
                if (child.isMesh) {
                    if (child.visible !== false) {
                        child.visible = false;
                    }
                    lowHiddenSet++;
                }
            });
            console.log(`📌 低解像度メッシュ: ${lowHiddenSet}個を表示無効に設定`);
            
            console.log(`✅ 低解像度街モデル読み込み完了: ${lodMeshCount}個のメッシュ`);
            console.log(`📊 LODマッピング: ${lodMeshMap.size}個のメッシュペア`);
            
            // === デバッグ用：マッピング結果の詳細を出力 ===
            console.log('🔍 LODマッピング詳細：');
            let completePairs = 0;
            let incompletePairs = 0;
            lodMeshMap.forEach((meshPair, meshName) => {
                if (meshPair.high && meshPair.low) {
                    console.log(`  ✓ ${meshName}`);
                    completePairs++;
                } else {
                    console.warn(`  ✗ ${meshName} (high: ${!!meshPair.high}, low: ${!!meshPair.low})`);
                    incompletePairs++;
                }
            });
            console.log(`完全なペア: ${completePairs}, 不完全なペア: ${incompletePairs}`);
            
            // === 初期状態サニティチェック ===
            let initHighVisibleCount = 0;
            let initLowVisibleCount = 0;
            let initBothVisibleCount = 0;
            
            lodMeshMap.forEach((meshPair, meshName) => {
                if (meshPair.high && meshPair.low) {
                    if (meshPair.high.visible) initHighVisibleCount++;
                    if (meshPair.low.visible) initLowVisibleCount++;
                    if (meshPair.high.visible && meshPair.low.visible) initBothVisibleCount++;
                }
            });
            
            console.log(`📊 初期化完了時の状態: 高=${initHighVisibleCount}個表示, 低=${initLowVisibleCount}個表示, 両方=${initBothVisibleCount}個表示`);
        }, undefined, function(error) {
            console.error('❌ 低解像度街モデル読み込みエラー:', error);
        });
    }

    // --- 読み込み呼び出し ---
    loadCityModel();

    // === LOD\u66f4\u65b0\u95a2\u6570\uff08\u6bce\u30d5\u30ec\u30fc\u30e0\u5442\u3076\u308a\u5b9f\u884c\uff09 ===
    const lodUpdateCheckInterval = 100; // 100ms\u54b1\u3021\u306b\u30c1\u30a7\u30c3\u30af\uff08\u30d1\u30d5\u30a9\u30fc\u30de\u30f3\u30b9\u6700\u9069\u5316\uff09
    let lastLODUpdateTime = 0;

    function updateMeshLOD(playerPos) {
        const currentTime = Date.now();
        
        // チェック間隔に達していなければスキップ
        if (currentTime - lastLODUpdateTime < lodUpdateCheckInterval) {
            return;
        }
        lastLODUpdateTime = currentTime;

        console.log(`🔄 LOD更新実行 (${lodMeshMap.size}個メッシュチェック): プレイヤー位置=(${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}, ${playerPos.z.toFixed(1)})`);

        let switchCount = 0;
        let highVisibleCount = 0;
        let lowVisibleCount = 0;

        lodMeshMap.forEach((meshPair, meshName) => {
            if (!meshPair.high || !meshPair.low) {
                return;
            }

            const highMesh = meshPair.high;
            const lowMesh = meshPair.low;

            const meshWorldPos = new THREE.Vector3();
            highMesh.getWorldPosition(meshWorldPos);

            const distance = playerPos.distanceTo(meshWorldPos);
            const lodSwitchDistance = LOD_DISTANCE;
            const lodHysteresis = 20;

            // 前の状態を保存
            const prevHighVisible = highMesh.visible;
            const prevLowVisible = lowMesh.visible;

            if (distance > lodSwitchDistance + lodHysteresis) {
                // 遠距離: 低解像度に切り替え
                highMesh.visible = false;
                lowMesh.visible = true;
            } else if (distance <= lodSwitchDistance - lodHysteresis) {
                // 近距離: 高解像度に切り替え
                highMesh.visible = true;
                lowMesh.visible = false;
            }
            // 中間距離: 変更なし

            // 状態変化をカウント
            if (prevHighVisible !== highMesh.visible || prevLowVisible !== lowMesh.visible) {
                switchCount++;
                if (highMesh.visible) {
                    highVisibleCount++;
                } else {
                    lowVisibleCount++;
                }
            } else {
                // 状態が変わらない場合もカウント
                if (highMesh.visible) {
                    highVisibleCount++;
                } else {
                    lowVisibleCount++;
                }
            }
        });

        // === 問題検出: 両方のメッシュが表示されているかチェック ===
        let doubleVisibleCount = 0;
        lodMeshMap.forEach((meshPair, meshName) => {
            if (meshPair.high && meshPair.low) {
                if (meshPair.high.visible && meshPair.low.visible) {
                    console.warn(`⚠️ 重複表示: ${meshName} (高=${meshPair.high.visible}, 低=${meshPair.low.visible})`);
                    doubleVisibleCount++;
                }
            }
        });

        console.log(`✅ LOD処理完了: 高解像度=${highVisibleCount}個, 低解像度=${lowVisibleCount}個, 重複表示=${doubleVisibleCount}個`);
    }

    // 地面モデル（city_ground.glb）を読み込む関数
    function loadGroundModel(modelName, position) {
        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.load(`models/${modelName}`, function(gltf) {
            let meshCount = 0;
            gltf.scene.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    // 地面メッシュを地面判定用に追加
                    groundCollisionMeshes.push(child);
                    meshCount++;
                }
            });
            gltf.scene.position.set(position.x, position.y, position.z);
            gltf.scene.scale.set(1, 1, 1);
            scene.add(gltf.scene);
        });
    }

    // 地面を読み込む
    loadGroundModel('city_ground.glb', { x: 0, y: 0.01, z: 0 });

    // --- 衝突判定: cityCollisionMeshes は壁用、groundCollisionMeshes は地面用 ---


    // === 昼夜切り替え関数（統一版） ===
    function switchDayNightMode(toNightMode) {
        isNightMode = toNightMode;
        
        if (isNightMode) {
            console.log('🌙 夜モード ON');
            
            // ===== 放射マテリアルを強化 =====
            emissiveMeshes.forEach(item => {
                const mat = item.mesh.material;
                if (mat) {
                    // 元の放射色と強度を1.5倍に増幅
                    mat.emissive.copy(item.originalEmissive);
                    mat.emissiveIntensity = item.originalIntensity * 1.5;
                    mat.needsUpdate = true;
                }
            });
            
            // ===== PointLight追加（初回のみ、投光効果を強化） =====
            if (cityModel.emissiveLights.length === 0) {
                // 街灯の数を制限（全てを追加するのではなく、4個に1個のみ配置）
                let lightCount = 0;
                const maxLights = 40; // 最大40個に制限
                
                emissiveMeshes.forEach((item, index) => {
                    // 4個に1個のみ追加（数を減らす）
                    if (index % 4 === 0 && lightCount < maxLights) {
                        const mesh = item.mesh;
                        const meshWorldPos = new THREE.Vector3();
                        mesh.getWorldPosition(meshWorldPos);
                        
                        const emissiveColor = item.originalEmissive.clone();
                        // ライト強度を強化（0.035 → 0.12に増幅して周囲を照らす）
                        const lightIntensity = item.originalIntensity * 0.12;
                        // 投光距離を延長（120 → 250に拡大）
                        const lightDistance = 250;
                        
                        const pointLight = new THREE.PointLight(emissiveColor, lightIntensity, lightDistance);
                        pointLight.position.copy(meshWorldPos);
                        pointLight.decay = 2.0;
                        pointLight.castShadow = false; // シャドウ計算を完全に無効化
                        
                        scene.add(pointLight);
                        cityModel.emissiveLights.push(pointLight);
                        lightCount++;
                    }
                });
                console.log(`💡 ${cityModel.emissiveLights.length}個のライト追加（投光強化版）`);
            } else {
                // 既存ライトを表示
                cityModel.emissiveLights.forEach(light => {
                    light.visible = true;
                });
            }
            
            // ===== 車のヘッドライトを有効化（シャドウなし） =====
            cars.forEach(car => {
                if (car && car.headlights) {
                    car.headlights.forEach(light => {
                        light.visible = true;
                        // ヘッドライトのシャドウ計算を無効化（パフォーマンス優先）
                        light.castShadow = false;
                    });
                }
            });
            console.log('🚗 車のヘッドライトON');
            
            // ===== Bloom効果を追加 =====
            if (!composer.passes.includes(composer.bloomPass)) {
                composer.addPass(composer.bloomPass);
            }
            
            // ===== ライティング変更（昼→夜、スポットライト範囲も最適化） =====
            scene.ambientLight.color.setHex(0x1a1a2e);
            scene.ambientLight.intensity = 0.85; // 0.6 → 0.85に強化
            scene.sunLight.color.setHex(0x4466aa);
            scene.sunLight.intensity = 0.4;
            
            // スポットライトの範囲を制限してパフォーマンスを向上
            cars.forEach(car => {
                if (car && car.headlights) {
                    car.headlights.forEach(light => {
                        if (light.target) {
                            light.distance = 80; // 光の距離を制限
                        }
                    });
                }
            });
            
            // ===== 空の設定を変更（夜モード） =====
            scene.sky.material = scene.skyMaterialNight;
            
            // ===== 星を表示 =====
            if (scene.stars) {
                scene.stars.visible = true;
            }
            
        } else {
            console.log('☀️ 昼モード ON');
            
            // ===== マテリアル更新：放射を完全に無効化し、窓色を空色に設定 =====
            emissiveMeshes.forEach(item => {
                const mat = item.mesh.material;
                if (mat) {
                    // emissiveを完全に消す（黒）、強度を0に
                    mat.emissive.setHex(0x000000);
                    mat.emissiveIntensity = 0.0;
                    
                    // 窓色を空色（0x87ceeb）に設定
                    mat.color.setHex(0x87ceeb);
                    
                    mat.needsUpdate = true;
                }
            });
            
            // ===== PointLight無効化 =====
            if (cityModel.emissiveLights) {
                cityModel.emissiveLights.forEach(light => {
                    light.visible = false;
                });
            }
            
            // ===== 車のヘッドライトを無効化 =====
            cars.forEach(car => {
                if (car && car.headlights) {
                    car.headlights.forEach(light => {
                        light.visible = false;
                    });
                }
            });
            console.log('🚗 車のヘッドライトOFF');
            
            // ===== Bloom効果を削除 =====
            if (composer.passes.includes(composer.bloomPass)) {
                composer.removePass(composer.bloomPass);
            }
            
            // ===== ライティング変更（夜→昼） =====
            scene.ambientLight.color.setHex(0xffffff);
            scene.ambientLight.intensity = 0.4;
            scene.sunLight.color.setHex(0xffffff);
            scene.sunLight.intensity = 1.2;
            
            // ===== 空の設定を変更（昼モード：雲テクスチャ） =====
            scene.sky.material = scene.skyMaterialDay;
            
            // ===== 星を非表示 =====
            if (scene.stars) {
                scene.stars.visible = false;
            }
        }
    }

    // Fキーで乗車・降車切り替え
    document.addEventListener('keydown', (event) => {
        // === Nキー：昼夜切り替え ===
        if (event.code === 'KeyN') {
            switchDayNightMode(!isNightMode);
        }
        
        if (event.code === 'KeyF') {
            if (!isCarMode) {
                // 歩行者モード時、最も近い車に乗る
                const playerPos = controls.getObject().position;
                let minDist = enterCarDistance;
                let closestCarIdx = -1;

                for (let i = 0; i < cars.length; i++) {
                    if (cars[i].loaded && cars[i].object) {
                        const dist = playerPos.distanceTo(cars[i].object.position);
                        if (dist < minDist) {
                            minDist = dist;
                            closestCarIdx = i;
                        }
                    }
                }

                if (closestCarIdx >= 0) {
                    activeCarIndex = closestCarIdx;
                    isCarMode = true;
                    // 乗車時：ドライバーレス走行フラグをリセット
                    cars[closestCarIdx].isDriverless = false;
                    // ドライバーレス走行状態をリセット
                    cars[closestCarIdx].state.throttle = 0;
                    cars[closestCarIdx].state.steer = 0;
                    // 乗車時：銃をシーンから削除
                    if (gunLoaded && gunObject && gunObject.parent !== null) {
                        scene.remove(gunObject);
                    }
                }
            } else if (isCarMode && activeCarIndex >= 0) {
                // 車モード時、降りる
                isCarMode = false;
                rotationDiv.style.display = 'none'; // 回転情報表示を非表示
                speedDiv.style.display = 'none'; // スピード表示も非表示
                const car = cars[activeCarIndex];
                if (car && car.object) {
                    const carPos = car.object.position.clone();
                    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(car.object.quaternion).normalize();
                    const exitPos = carPos.clone().add(right.multiplyScalar(2));
                    
                    // 降車位置の地形高さを検出
                    let exitHeight = groundHeight; // デフォルト値
                    if (groundCollisionMeshes.length > 0) {
                        const rayOrigin = exitPos.clone().add(new THREE.Vector3(0, 2.0, 0));
                        const downDir = new THREE.Vector3(0, -1, 0);
                        const raycaster = new THREE.Raycaster(rayOrigin, downDir, 0, 10.0);
                        const intersects = raycaster.intersectObjects(groundCollisionMeshes, true);
                        if (intersects.length > 0) {
                            exitHeight = intersects[0].point.y + 1.6; // 地面 + 視点高さ
                        }
                    }
                    
                    controls.getObject().position.set(exitPos.x, exitHeight, exitPos.z);
                    
                    // === 降車時の処理：ドライバーレス走行の開始 ===
                    // アクセルをゼロに設定（エンジンは回り続けるが、新たな加速は行わない）
                    car.state.throttle = 0;
                    // ハンドルをゼロに設定（真っすぐに走るように）
                    car.state.steer = 0;
                    // フラグを設定：ドライバーレス走行中
                    car.isDriverless = true;
                    // カメラビューモードをリセット（歩行モードに戻す）
                    carViewMode = 1;
                }
                // activeCarIndexは保持し続ける（ドライバーレス走行中も物理演算を続けるため）
            }
        }

        // 車モード時のみ視点切り替え
        if (isCarMode && activeCarIndex >= 0) {
            if (event.code === 'Digit1') {
                carViewMode = 1; // 三人称
            }
            if (event.code === 'Digit2') {
                carViewMode = 2; // 車内視点
            }
        }

        if (!isCarMode) {
            // 歩行者モードのキー処理（既存のまま）
            switch (event.code) {
                case 'KeyW': moveForward = true; break;
                case 'KeyS': moveBackward = true; break;
                case 'KeyA': rotateLeft = true; break;
                case 'KeyD': rotateRight = true; break;
                case 'KeyH':
                    if (!overviewMode) {
                        overviewMode = true;
                        // カメラ位置・向きを保存
                        savedCameraPosition = camera.position.clone();
                        savedCameraQuaternion = camera.quaternion.clone();
                    }
                    break;
                case 'Space':
                    if (!isJumping) {
                        // 地形ベースでジャンプ可能か判定
                        let canJump = false;
                        
                        if (groundCollisionMeshes.length > 0) {
                            // 足元の複数点からレイキャストして確認
                            const checkPoints = [
                                new THREE.Vector3(0, 0, 0),      // 中心
                                new THREE.Vector3(0.2, 0, 0),    // 右
                                new THREE.Vector3(-0.2, 0, 0),   // 左
                                new THREE.Vector3(0, 0, 0.2),    // 前
                                new THREE.Vector3(0, 0, -0.2)    // 後ろ
                            ];
                            
                            for (const offset of checkPoints) {
                                const rayOrigin = controls.getObject().position.clone().add(offset).add(new THREE.Vector3(0, -0.5, 0));
                                const downRay = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, 2.0);
                                const groundIntersects = downRay.intersectObjects(groundCollisionMeshes, true);
                                
                                if (groundIntersects.length > 0) {
                                    const groundY = groundIntersects[0].point.y;
                                    const playerY = controls.getObject().position.y;
                                    // 視点がおよそ地面から1.6上なら着地状態と判定
                                    if (Math.abs(playerY - (groundY + 1.6)) <= 0.2) {
                                        canJump = true;
                                        break;
                                    }
                                }
                            }
                        } else if (Math.abs(controls.getObject().position.y - groundHeight) < 0.1) {
                            // 地面メッシュがない場合は従来の判定
                            canJump = true;
                        }
                        
                        if (canJump) {
                            isJumping = true;
                            velocityY = jumpVelocity; // ジャンプ初速度を設定
                        }
                    }
                    break;
            }
        }
        if (isCarMode) {
            switch (event.code) {
                case 'KeyW': carForward = true; break;
                case 'KeyS': carBackward = true; break;
                case 'KeyA': carLeft = true; break;
                case 'KeyD': carRight = true; break;
                case 'ShiftLeft':
                case 'ShiftRight': carBrake = true; break;
                case 'KeyH':
                    if (!overviewMode) {
                        overviewMode = true;
                        savedCameraPosition = camera.position.clone();
                        savedCameraQuaternion = camera.quaternion.clone();
                    }
                    break;
            }
        }
    });
    document.addEventListener('keyup', (event) => {
        if (!isCarMode) {
            switch (event.code) {
                case 'KeyW': moveForward = false; break;
                case 'KeyS': moveBackward = false; break;
                case 'KeyA': rotateLeft = false; break;
                case 'KeyD': rotateRight = false; break;
                case 'KeyH':
                    overviewMode = false;
                    // カメラ位置・向きを復元
                    if (savedCameraPosition && savedCameraQuaternion) {
                        camera.position.copy(savedCameraPosition);
                        camera.quaternion.copy(savedCameraQuaternion);
                    }
                    break;
            }
        }
        if (isCarMode) {
            switch (event.code) {
                case 'KeyW': carForward = false; break;
                case 'KeyS': carBackward = false; break;
                case 'KeyA': carLeft = false; break;
                case 'KeyD': carRight = false; break;
                case 'ShiftLeft':
                case 'ShiftRight': carBrake = false; break;
                case 'KeyH':
                    overviewMode = false;
                    if (savedCameraPosition && savedCameraQuaternion) {
                        camera.position.copy(savedCameraPosition);
                        camera.quaternion.copy(savedCameraQuaternion);
                    }
                    break;
            }
        }
    });

    // 左クリック（長押し対応）
    document.addEventListener('mousedown', (event) => {
        if (event.button === 0 && !isCarMode && gunLoaded && gunObject) {
            isShooting = true;
            lastShotTime = Date.now(); // 最初の射撃をすぐに行うため時間をセット
        }
    });
    
    document.addEventListener('mouseup', (event) => {
        if (event.button === 0) {
            isShooting = false;
        }
    });
    
    // 射撃処理を実行する関数
    function shoot() {
        if (!gunLoaded || !gunObject) return;
        
        const currentTime = Date.now();
        if (currentTime - lastShotTime < shootingRateLimit) {
            return; // レート制限
        }
        lastShotTime = currentTime;
            // カメラの向き（画面中央）
            const cameraDir = new THREE.Vector3();
            controls.getDirection(cameraDir);
            
            // 銃口の位置：カメラ座標に対するオフセットで設定
            const muzzleOffsetWorld = gunMuzzleOffset.clone().applyQuaternion(camera.quaternion);
            const muzzlePos = camera.position.clone().add(muzzleOffsetWorld);
            
            // レイキャストで着弾判定（銃口から0.5以降の距離で判定、銃自身との衝突を避ける）
            const raycaster = new THREE.Raycaster(muzzlePos, cameraDir, 0.5, 10000);
            const intersects = raycaster.intersectObjects(scene.children, true);
            
            // 町のモデル（city_collider以外）に衝突したかチェック
            let hitPoint = null;
            let hitNormal = null;
            
            for (let intersection of intersects) {
                const obj = intersection.object;
                // 銃や弾自身には衝突しない
                if (obj === gunObject || obj.parent === gunObject) continue;
                
                // エフェクトオブジェクトも除外
                if (impactEffectObjects.includes(obj)) continue;
                
                // city_colliderは除外（透明な当たり判定用）
                let isCollider = false;
                let current = obj;
                while (current) {
                    if (current.name && current.name.includes('collider')) {
                        isCollider = true;
                        break;
                    }
                    current = current.parent;
                }
                if (isCollider) continue;
                
                hitPoint = intersection.point;
                
                // 面の法線を取得
                if (intersection.face) {
                    hitNormal = intersection.face.normal.clone();
                    hitNormal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(intersection.object.matrixWorld));
                } else {
                    hitNormal = cameraDir.clone().multiplyScalar(-1);
                }
                
                break;
            }
            
            // 着弾エフェクトを生成
            if (hitPoint) {
                // 弾道線を生成
                createBulletTrail(muzzlePos, hitPoint);
                
                createImpactEffect(hitPoint, hitNormal);
                
                // === NPC当たり判定 ===
                for (let i = 0; i < npcs.length; i++) {
                    const npc = npcs[i];
                    const distance = npc.object.position.distanceTo(hitPoint);
                    
                    // NPCの近くに着弾した場合、ノックダウン
                    if (distance < 3.0) {
                        npc.state = 'knocked_down';
                        npc.knockedDownTime = 0;
                        
                        // 銃弾の速度（射撃速度）を推定
                        const bulletSpeed = 400; // m/s（現実的な銃弾速度）
                        
                        // NPCを吹き飛ばす方向を計算（NPCから着弾点への逆方向）
                        const knockbackDir = npc.object.position.clone().sub(hitPoint).normalize();
                        
                        // 銃弾による吹き飛び速度（ゲームバランス重視）
                        // 基本速度：5.0 m/s（水平） - 強化
                        const baseKnockbackSpeed = 5.0;
                        
                        // 距離に応じて吹き飛ぶ力を調整（着弾点に近いほど強い）
                        const distanceFromHit = Math.max(0.1, 3.0 - distance); // 0.1～3.0
                        const knockbackMultiplier = distanceFromHit / 3.0; // 0.033～1.0
                        
                        const horizontalSpeed = baseKnockbackSpeed * knockbackMultiplier;
                        
                        // 速度を設定
                        npc.velocity = knockbackDir.clone().multiplyScalar(horizontalSpeed);
                        npc.velocity.y = 2.5; // 上方向の速度 - 強化
                        
                        // 回転速度も付与
                        const randomAxis = new THREE.Vector3(
                            Math.random() - 0.5,
                            Math.random() - 0.5,
                            Math.random() - 0.5
                        ).normalize();
                        npc.angularVelocity.copy(randomAxis.multiplyScalar(horizontalSpeed * 2.5)); // 角速度 - 強化
                        break;
                    }
                }
                
                // 物理オブジェクトへのダメージ判定
                for (const physObj of physicsObjects) {
                    if (physObj.colliderMeshes && physObj.colliderMeshes.length > 0) {
                        // 衝突判定：hitPointが物理オブジェクトのバウンディングボックス内か確認
                        const bbox = getColliderBoundingBox(physObj.colliderMeshes);
                        if (bbox.containsPoint(hitPoint)) {
                            // 物理オブジェクトに対して銃弾の衝撃を与える
                            // 銃弾のエネルギー：約8ジュール相当（軽い銃弾）
                            // F=ma より加速度を計算：a = F/m = エネルギー/(質量 × 距離)
                            const bulletEnergy = 400; // ジュール
                            const impactDistance = 0.05; // メートル（衝撃範囲）
                            const bulletForce = bulletEnergy / impactDistance; // 約160N
                            const acceleration = bulletForce / physObj.mass; // a = F/m
                            
                            const impactVelocity = cameraDir.clone().multiplyScalar(acceleration * 0.016); // 1フレーム相当で加速度適用
                            physObj.velocity.add(impactVelocity);
                            
                            // 回転も追加（ランダムな軸、小さめ）
                            const randomAxis = new THREE.Vector3(
                                Math.random() - 0.5,
                                Math.random() - 0.5,
                                Math.random() - 0.5
                            ).normalize();
                            physObj.angularVelocity.add(randomAxis.multiplyScalar(3));
                            physObj.isActive = true;
                            break;
                        }
                    }
                }
            }
            
            // マズルフラッシュエフェクトを銃口に生成
            createMuzzleFlash(muzzlePos, cameraDir);
            
            // 銃声SEをランダムで再生
            if (shotAudioBuffers.length > 0) {
                const randomIndex = Math.floor(Math.random() * shotAudioBuffers.length);
                playAudio(shotAudioBuffers[randomIndex], 0.5); // ボリュームは50%
            }
    }
    
    // 弾道線生成関数
    function createBulletTrail(startPos, endPos) {
        const trailGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array([
            startPos.x, startPos.y, startPos.z,
            endPos.x, endPos.y, endPos.z
        ]);
        
        trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const trailMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff,
            linewidth: 3
        });
        
        const trailLine = new THREE.Line(trailGeometry, trailMaterial);
        scene.add(trailLine);
        
        // 弾道線を配列に追加
        const trail = {
            line: trailLine,
            startTime: Date.now(),
            duration: bulletTrailDuration
        };
        
        bulletTrails.push(trail);
    }
    
    // 着弾エフェクト生成関数
    function createImpactEffect(position, normal) {
        const effectDuration = 500; // ミリ秒
        const particleCount = 12;
        const particleGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        
        // パーティクルの初期位置（着弾点周辺）
        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            const distance = 0.1;
            positions[i * 3] = position.x + Math.cos(angle) * distance;
            positions[i * 3 + 1] = position.y + Math.sin(angle) * distance;
            positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.1;
        }
        
        particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const particleMaterial = new THREE.PointsMaterial({
            color: 0xff8800,
            size: 0.15,
            sizeAttenuation: true
        });
        
        const particles = new THREE.Points(particleGeometry, particleMaterial);
        scene.add(particles);
        
        // 爆破エフェクト用の拡大球
        const explosionGeometry = new THREE.SphereGeometry(0.15, 8, 8);
        const explosionMaterial = new THREE.MeshBasicMaterial({
            color: 0xff8800,
            transparent: true,
            opacity: 0.8
        });
        const explosionMesh = new THREE.Mesh(explosionGeometry, explosionMaterial);
        explosionMesh.position.copy(position);
        scene.add(explosionMesh);
        
        // エフェクト管理オブジェクト
        const effect = {
            particles: particles,
            explosionMesh: explosionMesh,
            startTime: Date.now(),
            duration: effectDuration,
            initialPositions: new Float32Array(positions)
        };
        
        impactEffects.push(effect);
        // レイキャスト除外用に参照を追加
        impactEffectObjects.push(particles);
        impactEffectObjects.push(explosionMesh);
    }
    
    // マズルフラッシュ生成関数
    function createMuzzleFlash(position, direction) {
        const flashDuration = 100; // ミリ秒（短時間）
        const particleCount = 8;
        const particleGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        
        // パーティクルの初期位置（銃口から前方に拡散）
        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            const distance = 0.05;
            positions[i * 3] = position.x + Math.cos(angle) * distance;
            positions[i * 3 + 1] = position.y + Math.sin(angle) * distance;
            positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.05;
        }
        
        particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const particleMaterial = new THREE.PointsMaterial({
            color: 0xffcc00,
            size: 0.12,
            sizeAttenuation: true
        });
        
        const particles = new THREE.Points(particleGeometry, particleMaterial);
        scene.add(particles);
        
        // フラッシュ球（一瞬明るく光る）
        const flashGeometry = new THREE.SphereGeometry(0.1, 6, 6);
        const flashMaterial = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.9
        });
        const flashMesh = new THREE.Mesh(flashGeometry, flashMaterial);
        flashMesh.position.copy(position);
        scene.add(flashMesh);
        
        // マズルフラッシュ管理オブジェクト
        const flash = {
            particles: particles,
            flashMesh: flashMesh,
            startTime: Date.now(),
            duration: flashDuration,
            initialPositions: new Float32Array(positions),
            direction: direction.clone()
        };
        
        muzzleFlashEffects.push(flash);
        // レイキャスト除外用に参照を追加
        impactEffectObjects.push(particles);
        impactEffectObjects.push(flashMesh);
    }

    const controls = new THREE.PointerLockControls(camera, renderer.domElement);

    // スポーン位置とカメラ向きを設定
    camera.position.copy(spawnPosition);
    
    // PointerLockControlsのeulerを使用してカメラの向きを設定
    const euler = new THREE.Euler(spawnRotation.pitch, spawnRotation.yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);

    // 移動速度を調整する変数
    let moveSpeed = 7.0; // 走り速度（m/s）

    // マウス感度（回転速度）を調整する変数
    let mouseSensitivity = 0.5; // 小さいほどゆっくり、大きいほど速い

    controls.pointerSpeed = mouseSensitivity;

    canvasElement.addEventListener('click', () => {
        controls.lock();
        // Web Audio APIのオーディオコンテキストを初期化
        const ctx = getAudioContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume();
        }
    });

    const fpsDiv = document.createElement('div');
    fpsDiv.style.position = 'absolute';
    fpsDiv.style.left = '10px';
    fpsDiv.style.top = '10px';
    fpsDiv.style.color = '#fff';
    fpsDiv.style.background = 'rgba(0,0,0,0.5)';
    fpsDiv.style.padding = '4px 8px';
    fpsDiv.style.fontFamily = 'monospace';
    fpsDiv.style.fontSize = '14px';
    fpsDiv.style.zIndex = '100';
    fpsDiv.innerText = 'FPS: 0';
    document.body.appendChild(fpsDiv);

    const polyDiv = document.createElement('div');
    polyDiv.style.position = 'absolute';
    polyDiv.style.left = '10px';
    polyDiv.style.top = '34px';
    polyDiv.style.color = '#fff';
    polyDiv.style.background = 'rgba(0,0,0,0.5)';
    polyDiv.style.padding = '4px 8px';
    polyDiv.style.fontFamily = 'monospace';
    polyDiv.style.fontSize = '14px';
    polyDiv.style.zIndex = '100';
    polyDiv.innerText = 'Polygons: 0';
    document.body.appendChild(polyDiv);
    
    const posDiv = document.createElement('div');
    posDiv.style.position = 'absolute';
    posDiv.style.left = '10px';
    posDiv.style.top = '58px';
    posDiv.style.color = '#fff';
    posDiv.style.background = 'rgba(0,0,0,0.5)';
    posDiv.style.padding = '4px 8px';
    posDiv.style.fontFamily = 'monospace';
    posDiv.style.fontSize = '14px';
    posDiv.style.zIndex = '100';
    posDiv.innerText = 'Pos: (0, 0, 0)';
    document.body.appendChild(posDiv);

    // バージョン情報表示
    const versionDiv = document.createElement('div');
    versionDiv.style.position = 'absolute';
    versionDiv.style.left = '10px';
    versionDiv.style.top = '82px';
    versionDiv.style.color = '#aaa';
    versionDiv.style.background = 'rgba(0,0,0,0.5)';
    versionDiv.style.padding = '2px 6px';
    versionDiv.style.fontFamily = 'monospace';
    versionDiv.style.fontSize = '12px';
    versionDiv.style.zIndex = '100';
    const buildDate = new Date().toLocaleString('ja-JP');
    versionDiv.innerText = `Build: ${buildDate}`;
    document.body.appendChild(versionDiv);

    // speedDivの生成部分をコメントアウトまたは削除
    
    // スピードメーター＋タコメーター表示用DIV
    const speedDiv = document.createElement('div');
    speedDiv.style.position = 'absolute';
    speedDiv.style.right = '10px';
    speedDiv.style.bottom = '210px';
    speedDiv.style.color = '#0f0';
    speedDiv.style.background = 'rgba(0,0,0,0.9)';
    speedDiv.style.padding = '15px 25px';
    speedDiv.style.fontFamily = 'Courier New, monospace';
    speedDiv.style.fontSize = '16px';
    speedDiv.style.fontWeight = 'bold';
    speedDiv.style.zIndex = '1000';
    speedDiv.style.whiteSpace = 'pre';
    speedDiv.style.border = '3px solid #0f0';
    speedDiv.style.display = 'block';
    speedDiv.style.lineHeight = '1.8';
    speedDiv.style.borderRadius = '8px';
    speedDiv.style.textAlign = 'center';
    speedDiv.innerText = 'Not in car';
    document.body.appendChild(speedDiv);
    
    // 車両回転情報表示用DIV
    const rotationDiv = document.createElement('div');
    rotationDiv.style.position = 'absolute';
    rotationDiv.style.right = '10px';
    rotationDiv.style.bottom = '70px';
    rotationDiv.style.color = '#fff';
    rotationDiv.style.background = 'rgba(0,0,0,0.5)';
    rotationDiv.style.padding = '4px 12px';
    rotationDiv.style.fontFamily = 'monospace';
    rotationDiv.style.fontSize = '14px';
    rotationDiv.style.zIndex = '100';
    rotationDiv.style.display = 'none'; // 乗車時のみ表示
    rotationDiv.style.whiteSpace = 'pre-line'; // 改行を許可
    rotationDiv.innerText = '';
    document.body.appendChild(rotationDiv);
    

    const enterCarDiv = document.createElement('div');
    enterCarDiv.style.position = 'absolute';
    enterCarDiv.style.left = '50%';
    enterCarDiv.style.top = '50%';
    enterCarDiv.style.transform = 'translate(-50%, -50%)';
    enterCarDiv.style.color = '#fff';
    enterCarDiv.style.background = 'rgba(0,0,0,0.7)';
    enterCarDiv.style.padding = '16px 32px';
    enterCarDiv.style.fontFamily = 'monospace';
    enterCarDiv.style.fontSize = '28px';
    enterCarDiv.style.zIndex = '200';
    enterCarDiv.style.borderRadius = '12px';
    enterCarDiv.style.display = 'none';
    enterCarDiv.innerText = 'Ｆで乗車';
    document.body.appendChild(enterCarDiv);

    // ===== ミニマップの作成 =====
    const minimapWidth = 250;
    const minimapHeight = 250;
    
    // ミニマップ用キャンバス（表示用）
    const minimapCanvas = document.createElement('canvas');
    minimapCanvas.width = minimapWidth;
    minimapCanvas.height = minimapHeight;
    minimapCanvas.style.position = 'absolute';
    minimapCanvas.style.right = '10px';
    minimapCanvas.style.bottom = '10px';
    minimapCanvas.style.border = '3px solid #fff';
    minimapCanvas.style.backgroundColor = 'rgba(0, 20, 40, 0.8)';
    minimapCanvas.style.zIndex = '100';
    minimapCanvas.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.8)';
    document.body.appendChild(minimapCanvas);
    
    const minimapCtx = minimapCanvas.getContext('2d');
    
    // ミニマップ用のレンダリングターゲット
    const minimapRenderTarget = new THREE.WebGLRenderTarget(minimapWidth, minimapHeight);
    
    // ミニマップ用カメラ（上から見下ろす視点）
    const minimapCamera = new THREE.OrthographicCamera(
        -minimapWidth / 2 / 10,
        minimapWidth / 2 / 10,
        minimapHeight / 2 / 10,
        -minimapHeight / 2 / 10,
        0.1,
        2000
    );
    minimapCamera.position.set(0, 100, 0);
    minimapCamera.lookAt(0, 0, 0);
    
    // ミニマップ用の照明を追加
    const minimapLight = new THREE.DirectionalLight(0xffffff, 1.5);
    minimapLight.position.set(100, 200, 100);
    const minimapLightTarget = new THREE.Object3D();
    minimapLightTarget.position.set(0, 0, 0);
    minimapLight.target = minimapLightTarget;

    function canMove(newPosition) {
        // 8方向にレイを飛ばしてカメラの半径分の衝突を調べる
        const directions = [
            new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
            new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
            new THREE.Vector3(1, 0, 1).normalize(), new THREE.Vector3(-1, 0, 1).normalize(),
            new THREE.Vector3(1, 0, -1).normalize(), new THREE.Vector3(-1, 0, -1).normalize()
        ];
        for (let dir of directions) {
            const raycaster = new THREE.Raycaster(
                newPosition, dir, 0, cameraRadius
            );
            const intersects = raycaster.intersectObjects(collisionMeshes, true);
            if (intersects.length > 0) {
                return false; // どれかに当たったら移動不可
            }
        }
        return true;
    }
        
    function animate() {
        requestAnimationFrame(animate);

        // ウィンドウリサイズに対応
        if (window.innerWidth !== width || window.innerHeight !== height) {
            width = window.innerWidth;
            height = window.innerHeight;
            
            renderer.setSize(width, height);
            composer.setSize(width, height); // Bloom用コンポーザーもリサイズ
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        }
        
        // === スカイドーム（空）をカメラ位置に追従させる ===
        if (scene.sky) {
            scene.sky.position.copy(camera.position);
        }
        
        // === 星もカメラ位置に追従させる ===
        if (scene.stars) {
            scene.stars.position.copy(camera.position);
        }

        const now = performance.now();
        const deltaTime = now - lastFrameTime;
        lastFrameTime = now;
        accumulatedTime += deltaTime;

        // フレームレート制限：必要な時間が経過するまでスキップ
        if (accumulatedTime < frameDuration) {
            return;
        }
        accumulatedTime -= frameDuration;

        frames++;
        if (now - lastTime >= 1000) {
            fps = frames;
            frames = 0;
            lastTime = now;
            fpsDiv.innerText = `FPS: ${fps}`;
        }
        const info = renderer.info;
        polyDiv.innerText = `Polygons: ${info.render.triangles}`;

        let camPos;
        if (overviewMode) {
            // 町の中心上空から見下ろす視点
            const lookTarget = new THREE.Vector3(0, 0, 0); // 町の中心（必要に応じて調整）
            camera.position.set(0, 400, 0);
            camera.lookAt(lookTarget);
            camPos = camera.position;
        } else {
            if (!isCarMode) {
                camPos = controls.getObject().position;
            } else if (carViewMode === 1 || carViewMode === 2) {
                camPos = camera.position;
            }
        }
        if (camPos) {
            posDiv.innerText = `Pos: (${camPos.x.toFixed(2)}, ${camPos.y.toFixed(2)}, ${camPos.z.toFixed(2)})`;
        }

        const delta = clock.getDelta();
        mixers.forEach(mixer => mixer.update(delta));
        // すべての車のミキサーを更新
        cars.forEach(car => {
            if (car.mixer) car.mixer.update(delta);
        });

        // === LOD（Level of Detail）更新処理 ===
        if (camPos && cityModel && cityModelLow && lodMeshMap.size > 0) {
            updateMeshLOD(camPos);
        } else {
            // デバッグ: 条件をチェック
            if (!camPos) console.warn('⚠️ camPos不足');
            if (!cityModel) console.warn('⚠️ cityModel未読み込み');
            if (!cityModelLow) console.warn('⚠️ cityModelLow未読み込み');
            if (lodMeshMap.size === 0) console.warn('⚠️ lodMeshMapが空');
        }

        // 乗車可能な車の判定（最も近い車をチェック）
        canEnterCar = false;
        nearestCarIndex = -1;
        if (!isCarMode) {
            const playerPos = controls.getObject().position;
            let minDist = enterCarDistance;

            for (let i = 0; i < cars.length; i++) {
                if (cars[i].loaded && cars[i].object) {
                    const dist = playerPos.distanceTo(cars[i].object.position);
                    if (dist < minDist) {
                        minDist = dist;
                        nearestCarIndex = i;
                        canEnterCar = true;
                    }
                }
            }
        }

        if (canEnterCar && !isCarMode) {
            enterCarDiv.style.display = 'block';
        } else {
            enterCarDiv.style.display = 'none';
        }

        if (!isCarMode) {
            // 歩行者モード（既存の処理）
            let obj = controls.getObject();
            
            // 長押し中の連射処理
            if (isShooting && !isCarMode) {
                shoot();
            }
            
            if (isJumping) {
                // 重力を適用（delta時間ベース）
                velocityY += gravity * delta;
                obj.position.y += velocityY * delta;
                
                // 地面との距離を検出
                if (groundCollisionMeshes.length > 0) {
                    // プレイヤーの足元からレイキャスト
                    const rayOrigin = obj.position.clone().add(new THREE.Vector3(0, -0.5, 0)); // 足の高さから下へ
                    const downRay = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, 5.0);
                    const groundIntersects = downRay.intersectObjects(groundCollisionMeshes, true);
                    if (groundIntersects.length > 0) {
                        const groundY = groundIntersects[0].point.y;
                        const playerFootY = obj.position.y - 0.5; // プレイヤーの足の位置
                        // 速度が下向きで、足が地面付近に来たら着地
                        if (velocityY <= 0 && playerFootY <= groundY + 0.3) {
                            // プレイヤーを確実に地面に置く（足が地面から0.3上、視点がその1.3上）
                            obj.position.y = groundY + 1.6; // 視点を地面から1.6上に設定（従来の高さを保持）
                            isJumping = false;
                            velocityY = 0;
                        }
                    } else {
                        // 地面が見つからない場合、固定高さで着地
                        if (obj.position.y <= groundHeight) {
                            obj.position.y = groundHeight;
                            isJumping = false;
                            velocityY = 0;
                        }
                    }
                } else if (obj.position.y <= groundHeight) {
                    // 地面メッシュがない場合は従来の処理
                    obj.position.y = groundHeight;
                    isJumping = false;
                    velocityY = 0;
                }
            } else {
                // ジャンプ中でない時も地面に合わせるチェック
                if (groundCollisionMeshes.length > 0) {
                    // 複数点からレイキャストして最も低い地面を検出
                    const checkPoints = [
                        new THREE.Vector3(0, 0, 0),      // 中心
                        new THREE.Vector3(0.2, 0, 0),    // 右
                        new THREE.Vector3(-0.2, 0, 0),   // 左
                        new THREE.Vector3(0, 0, 0.2),    // 前
                        new THREE.Vector3(0, 0, -0.2)    // 後ろ
                    ];
                    
                    let lowestGround = null;
                    for (const offset of checkPoints) {
                        const rayOrigin = obj.position.clone().add(offset).add(new THREE.Vector3(0, -0.5, 0));
                        const downRay = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, 3.0);
                        const groundIntersects = downRay.intersectObjects(groundCollisionMeshes, true);
                        
                        if (groundIntersects.length > 0) {
                            const groundY = groundIntersects[0].point.y;
                            if (lowestGround === null || groundY < lowestGround) {
                                lowestGround = groundY;
                            }
                        }
                    }
                    
                    if (lowestGround !== null) {
                        // 最も低い地面に合わせて視点を調整
                        const targetY = lowestGround + 1.6;
                        const diff = targetY - obj.position.y;
                        // 坂の下りに対応するため調整速度を上げる
                        const adjustSpeed = Math.min(0.3, 0.1 + Math.abs(diff) * 0.1);
                        if (Math.abs(diff) > 0.01) {
                            obj.position.y += diff * adjustSpeed;
                        }
                    }
                }
            }
            // 前進・後退・左右移動
            const direction = new THREE.Vector3();
            controls.getDirection(direction);
            direction.y = 0;
            direction.normalize();

            const right = new THREE.Vector3();
            right.crossVectors(direction, camera.up).normalize();

            const currentPos = controls.getObject().position.clone();

            let moveVec = new THREE.Vector3();
            if (moveForward) moveVec.z -= 1;
            if (moveBackward) moveVec.z += 1;
            if (rotateRight) moveVec.x += 1;
            if (rotateLeft) moveVec.x -= 1;
            
            // 足音の再生（走行中かつ地面にいる時のみ）
            if (moveVec.length() > 0 && !isShooting && !isJumping && stepAudioBuffers.length > 0) {
                const currentTime = Date.now() / 1000; // 秒単位
                if (currentTime - lastStepTime >= stepSoundInterval) {
                    // ランダムに足音を選択して再生
                    const randomIndex = Math.floor(Math.random() * stepAudioBuffers.length);
                    playAudio(stepAudioBuffers[randomIndex], 0.3); // ボリュームは30%
                    lastStepTime = currentTime;
                }
            }
            
            if (moveVec.length() > 0) {
                moveVec.normalize();
                moveVec.applyQuaternion(camera.quaternion);
                moveVec.y = 0;
                moveVec.normalize();
                // 射撃中は移動速度を3分の1に制限（delta時間ベース）
                const currentMoveSpeed = isShooting ? moveSpeed / 3 : moveSpeed;
                const nextPos = currentPos.clone().add(moveVec.clone().multiplyScalar(currentMoveSpeed * delta));
                if (canMove(nextPos)) {
                    controls.getObject().position.copy(nextPos);
                }
            }

            // 銃の配置（走り動作を含む） - 歩行モード時のみ
            if (!isCarMode && gunLoaded && gunObject) {
                // 銃がシーンにまだ追加されていなければ追加
                if (gunObject.parent === null) {
                    scene.add(gunObject);
                }
                
                // カメラの位置を基準に銃を配置
                const cameraPos = camera.position.clone();
                
                // 移動中かどうかを判定（射撃中は走り動作をしない）
                const isMoving = moveVec.length() > 0 && !isShooting;
                
                // 基本的な銃のオフセット（停止時と走行時で異なる）
                let gunOffset = isMoving ? gunPositionRunning.clone() : gunPositionNormal.clone();
                
                // 走り動作：移動中は銃を左右に振る
                if (isMoving) {
                    // 時間ベースで左右に揺れるアニメーション
                    const time = Date.now() * 0.006; // スピード調整
                    const bobAmount = Math.sin(time) * 0.15; // 左右の振幅
                    const verticalBob = Math.abs(Math.sin(time * 0.5)) * 0.08; // 上下の揺れ（歩行感を出す）
                    
                    gunOffset.x += bobAmount; // 左右に振る
                    gunOffset.y += verticalBob; // 上下に揺れる
                    gunOffset.z -= 0.1; // 走り時はやや前に
                }
                
                gunOffset.applyQuaternion(camera.quaternion);
                gunObject.position.copy(cameraPos.clone().add(gunOffset));
                
                // 銃をカメラの向きに合わせ、走り時は横向きにする
                gunObject.quaternion.copy(camera.quaternion);
                
                if (isMoving) {
                    // 走り時に銃を横向きに（両手で持つ感じ）
                    const time = Date.now() * 0.006;
                    
                    // Y軸（上下方向）に90度回転させて横向きに
                    gunObject.rotateY(Math.PI / 2.5);
                    
                    // 銃を左右に揺れさせる
                    const bobAmount = Math.sin(time) * 0.2; // 左右の揺れを強調
                    gunObject.rotateZ(bobAmount);
                    
                    // 上下の小さな揺れ
                    const verticalBob = Math.sin(time * 0.5) * 0.1;
                    gunObject.rotateX(verticalBob);
                }
            } else if (isCarMode) {
                // 車モード時：銃をシーンから削除
                if (gunLoaded && gunObject && gunObject.parent !== null) {
                    scene.remove(gunObject);
                }
            }
        }
        
        // === NPC更新処理 ===（物理モデルベースに一新）
        for (let i = 0; i < npcs.length; i++) {
            const npc = npcs[i];
            if (!npc.object) continue;

            // 生成直後のカウント（物理モデルと同じ）
            if (npc.isSpawning) {
                npc.spawnFrameCount += delta; // 秒単位で加算
                if (npc.spawnFrameCount > 0.2) { // 0.2秒後に生成状態解除
                    npc.isSpawning = false;
                    npc.spawnFrameCount = 0;
                    if (npc.needsInitialPositioning) {
                        npc.needsInitialPositioning = false;
                    }
                }
            }
            
            if (npc.state === 'walking') {
                // ===== 歩行状態 =====
                npc.walkTimer += delta;
                
                // 一定時間ごとに進行方向を変更（秒単位）
                if (npc.walkTimer > npc.walkChangeInterval) {
                    npc.walkDirection = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
                    npc.walkTimer = 0;
                }
                
                // === 車との衝突判定（歩行中） ===
                for (let carIndex = 0; carIndex < cars.length; carIndex++) {
                    const car = cars[carIndex];
                    if (!car.object || !car.state) continue;
                    
                    const distance = npc.object.position.distanceTo(car.object.position);
                    const collisionDistance = 2.5;
                    
                    if (distance < collisionDistance) {
                        const carSpeed = Math.sqrt(car.state.vx ** 2 + car.state.vy ** 2);
                        
                        if (carSpeed > 0.1) {
                            const carMass = 1250;
                            const collisionDir = npc.object.position.clone().sub(car.object.position).normalize();
                            
                            const collisionTime = 0.1;
                            const npcMass = npc.mass;
                            const massRatio = carMass / (carMass + npcMass);
                            const acceleration = massRatio * (carSpeed / collisionTime);
                            
                            const maxAcceleration = 9 * 9.81; // 9G
                            const limitedAcceleration = Math.min(acceleration, maxAcceleration);
                            const acquiredSpeed = limitedAcceleration * collisionTime;
                            
                            // ノックダウン状態へ移行
                            npc.state = 'knocked_down';
                            npc.staticTimer = 0;
                            npc.velocity = collisionDir.clone().multiplyScalar(acquiredSpeed);
                            npc.velocity.y += Math.abs(acquiredSpeed) * 0.5; // 上方向にも吹っ飛ぶ
                            
                            // 回転速度を付与
                            const randomAxis = new THREE.Vector3(
                                Math.random() - 0.5,
                                Math.random() - 0.5,
                                Math.random() - 0.5
                            ).normalize();
                            npc.angularVelocity.copy(randomAxis.multiplyScalar(acquiredSpeed * 0.5));
                            
                            // アニメーション停止
                            if (npc.mixer && npc.walkAction) {
                                npc.walkAction.stop();
                            }
                            
                            // console.log('[NPC] Hit by car!');
                            break;
                        }
                    }
                }
                
                // === 前方の衝突判定（建物との衝突回避） ===
                if (cityCollisionMeshes.length > 0) {
                    const rayOrigin = npc.object.position.clone();
                    rayOrigin.y += 1.0; // 少し上から
                    
                    const rayDistance = 1.5; // 先読み距離（固定値で広め）
                    const raycaster = new THREE.Raycaster(rayOrigin, npc.walkDirection, 0, rayDistance);
                    const intersects = raycaster.intersectObjects(cityCollisionMeshes, true);
                    
                    if (intersects.length > 0) {
                        // 前方に建物がある場合、別の方向を探す
                        // 90度右方向を試す
                        const rightDir = new THREE.Vector3(-npc.walkDirection.z, 0, npc.walkDirection.x);
                        const raycasterRight = new THREE.Raycaster(rayOrigin, rightDir, 0, rayDistance);
                        if (raycasterRight.intersectObjects(cityCollisionMeshes, true).length === 0) {
                            npc.walkDirection.copy(rightDir);
                        } else {
                            // 90度左方向を試す
                            const leftDir = new THREE.Vector3(npc.walkDirection.z, 0, -npc.walkDirection.x);
                            const raycasterLeft = new THREE.Raycaster(rayOrigin, leftDir, 0, rayDistance);
                            if (raycasterLeft.intersectObjects(cityCollisionMeshes, true).length === 0) {
                                npc.walkDirection.copy(leftDir);
                            } else {
                                // 後ろ向きに
                                npc.walkDirection.multiplyScalar(-1);
                            }
                        }
                        npc.walkTimer = 0;
                    }
                }
                
                // 歩行移動（delta時間ベース）
                const moveAmount = npc.walkDirection.clone().multiplyScalar(npc.walkSpeed * delta);
                npc.object.position.add(moveAmount);
                
                // キャラの向きを移動方向に向ける
                const angle = Math.atan2(npc.walkDirection.x, npc.walkDirection.z);
                npc.object.rotation.y = angle;
                
                // === 歩行時の地面判定 ===
                if (groundCollisionMeshes.length > 0) {
                    const objCenterX = npc.object.position.x;
                    const objCenterZ = npc.object.position.z;
                    const objCenterY = npc.object.position.y;
                    
                    // NPCの推定高さ（中心から足元まで）
                    const estimatedHalfHeight = 1.0;
                    
                    // レイキャスト開始位置：初期配置時は高く、通常は足元から
                    const rayStartY = npc.needsInitialPositioning ? objCenterY + 10 : objCenterY;
                    const rayOrigin = new THREE.Vector3(objCenterX, rayStartY, objCenterZ);
                    const downDir = new THREE.Vector3(0, -1, 0);
                    const rayLength = npc.needsInitialPositioning ? 50.0 : (estimatedHalfHeight + 1.0);
                    const raycaster = new THREE.Raycaster(rayOrigin, downDir, 0, rayLength);
                    
                    const intersects = raycaster.intersectObjects(groundCollisionMeshes, true);
                    
                    if (intersects.length > 0) {
                        const groundY = intersects[0].point.y;
                        const npcHeight = 0.05; // 地面からのオフセット
                        const targetY = groundY + npcHeight + estimatedHalfHeight;
                        
                        if (npc.needsInitialPositioning) {
                            npc.object.position.y = targetY;
                            npc.needsInitialPositioning = false;
                        } else {
                            // 地面に追従（下にいる場合のみ）
                            const currentBottomY = objCenterY - estimatedHalfHeight;
                            if (currentBottomY < groundY + npcHeight + 0.1) {
                                const diff = targetY - npc.object.position.y;
                                if (Math.abs(diff) > 0.01) {
                                    npc.object.position.y += diff * 0.3;
                                } else {
                                    npc.object.position.y = targetY;
                                }
                            }
                        }
                        npc.isGrounded = true;
                    }
                }
                
            } else if (npc.state === 'knocked_down') {
                // ===== ノックダウン状態（物理オブジェクトと同じ処理） =====
                
                // === 重力適用 ===
                npc.velocity.y += npc.gravity * delta;
                
                // === 速度を位置に反映 ===
                npc.object.position.addScaledVector(npc.velocity, delta);
                
                // === 回転を適用 ===
                const angularVelLength = npc.angularVelocity.length();
                if (angularVelLength > 0.001) {
                    const rotationAxis = npc.angularVelocity.clone().normalize();
                    const rotationAngle = angularVelLength * delta;
                    const quat = new THREE.Quaternion();
                    quat.setFromAxisAngle(rotationAxis, rotationAngle);
                    npc.object.quaternion.multiplyQuaternions(quat, npc.object.quaternion);
                }
                
                // === 速度と回転速度の減衰 ===
                npc.velocity.multiplyScalar(npc.friction);
                npc.angularVelocity.multiplyScalar(0.95);
                
                // === 車との衝突判定（吹き飛び中も） ===
                for (let carIndex = 0; carIndex < cars.length; carIndex++) {
                    const car = cars[carIndex];
                    if (!car.object || !car.state) continue;
                    
                    const distance = npc.object.position.distanceTo(car.object.position);
                    const collisionDistance = 2.5;
                    
                    if (distance < collisionDistance) {
                        const carSpeed = Math.sqrt(car.state.vx ** 2 + car.state.vy ** 2);
                        
                        if (carSpeed > 0.5) {
                            const carMass = 1250;
                            const collisionDir = npc.object.position.clone().sub(car.object.position).normalize();
                            
                            const collisionTime = 0.1;
                            const npcMass = npc.mass;
                            const massRatio = carMass / (carMass + npcMass);
                            const acceleration = massRatio * (carSpeed / collisionTime);
                            
                            const maxAcceleration = 9 * 9.81;
                            const limitedAcceleration = Math.min(acceleration, maxAcceleration);
                            const acquiredSpeed = limitedAcceleration * collisionTime;
                            
                            npc.velocity.addScaledVector(collisionDir, acquiredSpeed);
                            npc.velocity.y += Math.abs(acquiredSpeed) * 0.5;
                            
                            const randomAxis = new THREE.Vector3(
                                Math.random() - 0.5,
                                Math.random() - 0.5,
                                Math.random() - 0.5
                            ).normalize();
                            npc.angularVelocity.addScaledVector(randomAxis, acquiredSpeed * 0.5);
                            
                            // 静止タイマーをリセット
                            npc.staticTimer = 0;
                        }
                    }
                }
                
                // === 街（壁）との衝突判定（物理オブジェクトと同じ） ===
                if (cityCollisionMeshes.length > 0) {
                    // バウンディングボックスをコライダーメッシュから計算
                    if (npc.colliderMeshes && npc.colliderMeshes.length > 0) {
                        npc.boundingBox = getColliderBoundingBox(npc.colliderMeshes);
                    } else {
                        if (!npc.boundingBox) {
                            npc.boundingBox = new THREE.Box3();
                        }
                        npc.boundingBox.setFromObject(npc.object);
                    }
                    
                    const checkPoints = [
                        npc.object.position.clone(),
                        npc.object.position.clone().add(new THREE.Vector3(0.5, 0, 0)),
                        npc.object.position.clone().add(new THREE.Vector3(-0.5, 0, 0)),
                        npc.object.position.clone().add(new THREE.Vector3(0, 0, 0.5)),
                        npc.object.position.clone().add(new THREE.Vector3(0, 0, -0.5))
                    ];
                    
                    for (const checkPoint of checkPoints) {
                        const horizontalVel = new THREE.Vector3(npc.velocity.x, 0, npc.velocity.z);
                        const velLength = horizontalVel.length();
                        
                        if (velLength > 0.01) {
                            const velocityDir = horizontalVel.clone().normalize();
                            const rayLength = Math.min(velLength * delta * 2, 0.5);
                            
                            const raycaster = new THREE.Raycaster(checkPoint, velocityDir, 0, rayLength);
                            const intersects = raycaster.intersectObjects(cityCollisionMeshes, true);
                            
                            if (intersects.length > 0) {
                                const hitNormal = intersects[0].face.normal.clone();
                                hitNormal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(intersects[0].object.matrixWorld));
                                
                                const isWall = Math.abs(hitNormal.y) < 0.5;
                                
                                if (isWall) {
                                    const restitution = 0.4;
                                    const wallNormal = new THREE.Vector3(hitNormal.x, 0, hitNormal.z).normalize();
                                    
                                    const horizontalVelReflect = new THREE.Vector3(npc.velocity.x, 0, npc.velocity.z);
                                    const dotProduct = horizontalVelReflect.dot(wallNormal);
                                    if (dotProduct < 0) {
                                        const reflectionForce = wallNormal.clone().multiplyScalar(-2 * dotProduct * restitution);
                                        npc.velocity.x = reflectionForce.x;
                                        npc.velocity.z = reflectionForce.z;
                                    }
                                    
                                    // 押し出し
                                    const bbSize = npc.boundingBox ? npc.boundingBox.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 2, 1);
                                    const bbHalfWidth = Math.max(Math.abs(wallNormal.x) * bbSize.x, Math.abs(wallNormal.z) * bbSize.z) / 2;
                                    const pushDistance = Math.max(0.15, bbHalfWidth + 0.05);
                                    
                                    npc.object.position.addScaledVector(wallNormal.clone(), pushDistance);
                                    break;
                                }
                            }
                        }
                    }
                }
                
                // === 地面との衝突判定 ===
                if (groundCollisionMeshes.length > 0) {
                    const objCenterX = npc.object.position.x;
                    const objCenterZ = npc.object.position.z;
                    const objCenterY = npc.object.position.y;
                    
                    // NPCの推定高さ（回転している場合も考慮して小さめに）
                    const estimatedHalfHeight = 0.5; // 横たわっている場合を考慮
                    
                    // レイキャスト開始位置：オブジェクトの中心から
                    const rayStartY = objCenterY;
                    const rayOrigin = new THREE.Vector3(objCenterX, rayStartY, objCenterZ);
                    const downDir = new THREE.Vector3(0, -1, 0);
                    // レイの長さを制限（屋根誤検出防止）
                    const rayLength = estimatedHalfHeight + 2.0;
                    const raycaster = new THREE.Raycaster(rayOrigin, downDir, 0, rayLength);
                    
                    const intersects = raycaster.intersectObjects(groundCollisionMeshes, true);
                    
                    if (intersects.length > 0) {
                        const groundY = intersects[0].point.y;
                        const minDistanceToGround = 0.05;
                        
                        // オブジェクトの最下点を地面に合わせる
                        const targetCenterY = groundY + minDistanceToGround + estimatedHalfHeight;
                        
                        // オブジェクトが地面より下にある場合のみ押し上げる
                        const currentBottomY = objCenterY - estimatedHalfHeight;
                        if (currentBottomY < groundY + minDistanceToGround) {
                            // 地面に接触
                            npc.object.position.y = targetCenterY;
                            
                            // 下方向の速度をリセット
                            if (npc.velocity.y < 0) {
                                npc.velocity.y = 0;
                            }
                            
                            // 地面摩擦による減衰
                            const speed = npc.velocity.length();
                            if (speed < 0.5) {
                                npc.velocity.multiplyScalar(0.9);
                                npc.angularVelocity.multiplyScalar(0.85);
                            }
                            
                            npc.isGrounded = true;
                        } else {
                            // 地面より上にいる場合は接地していない
                            npc.isGrounded = false;
                        }
                    } else {
                        // 地面がない場合の簡易判定
                        if (npc.object.position.y < 1.0) {
                            npc.object.position.y = 1.0;
                            npc.velocity.y = 0;
                            npc.isGrounded = true;
                        } else {
                            npc.isGrounded = false;
                        }
                    }
                }
                
                // === 静止判定と起き上がり ===
                // 速度と回転速度の両方をチェック（isGroundedに依存しない）
                const totalSpeed = npc.velocity.length();
                const totalAngularSpeed = npc.angularVelocity.length();
                
                // 速度が閾値以下なら静止とみなす（横たわっていても検出可能）
                if (totalSpeed < npc.staticThreshold && totalAngularSpeed < 1.0) {
                    npc.staticTimer += delta; // 秒単位で加算
                    
                    // 指定秒間静止したら回復状態へ
                    if (npc.staticTimer >= npc.recoverDelay) {
                        npc.state = 'recovering';
                        npc.recoverTime = 0;
                        npc.velocity.set(0, 0, 0);
                        npc.angularVelocity.set(0, 0, 0);
                        // console.log('[NPC] Static detected, starting recovery');
                    }
                } else {
                    // 動いている間はタイマーリセット
                    npc.staticTimer = 0;
                }
                
            } else if (npc.state === 'recovering') {
                // ===== 回復状態（起き上がり中） =====
                npc.recoverTime += delta; // 秒単位で加算
                
                // 徐々に直立に戻す（スムーズ補間）
                const recoverDuration = 0.5; // 0.5秒で起き上がり
                const t = Math.min(npc.recoverTime / recoverDuration, 1.0);
                
                // イージング関数（easeOutQuad）でスムーズに
                const eased = 1 - (1 - t) * (1 - t);
                
                // 現在の回転から直立状態へスラープ補間（毎フレーム進める）
                // deltaに応じて補間速度を調整
                const slerpFactor = Math.min(delta * 8, 0.3);
                npc.object.quaternion.slerp(npc.initialQuaternion, slerpFactor);
                
                if (npc.recoverTime >= recoverDuration) {
                    // 起き上がり完了、歩行状態に戻す
                    npc.state = 'walking';
                    npc.walkTimer = 0;
                    npc.staticTimer = 0;
                    npc.object.quaternion.copy(npc.initialQuaternion);
                    npc.object.rotation.set(0, 0, 0); // 回転も完全リセット
                    npc.angularVelocity.set(0, 0, 0);
                    npc.velocity.set(0, 0, 0); // 速度もリセット
                    
                    // 地面の高さを検出してNPCを配置
                    const groundRaycaster = new THREE.Raycaster();
                    const rayOrigin = npc.object.position.clone();
                    rayOrigin.y += 5; // 少し上からレイキャスト
                    groundRaycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));
                    groundRaycaster.far = 20;
                    
                    const groundIntersects = groundRaycaster.intersectObjects(cityCollisionMeshes, true);
                    if (groundIntersects.length > 0) {
                        // 地面の高さにNPCを配置
                        npc.object.position.y = groundIntersects[0].point.y;
                    }
                    
                    // 新しい歩行方向をランダムに決定
                    npc.walkDirection = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
                    
                    // アニメーション再開
                    if (npc.walkAction) {
                        npc.walkAction.play();
                    }
                }
            }
            
            // アニメーション更新
            if (npc.mixer) {
                npc.mixer.update(delta);
            }
        }
        
        // Bloom効果付きでレンダリング
        composer.render();
        if (activeCarIndex >= 0 && activeCarIndex < cars.length) {
            const car = cars[activeCarIndex];
            const carObject = car.object;
            
            // === シンプルで安定した車の物理パラメータ ===
            const carMass = 1250; // kg（実際の86は1238kg）
            const carMaxPowerHP = 222; // 最大馬力（実際の86は207PS → 222PSに増強）
            const carMaxPowerW = carMaxPowerHP * 0.7355 * 1000; // ps→W
            const carMaxTorque = 228; // 最大トルク (N・m)（実際の86は212N·m → 228N·mに増強）
            const carMaxRPM = 7000; // 最大回転数（実際の86は7000RPM）
            const carWheelBase = 2.6; // m
            const carTireRadius = 0.32; // m
            const carInertia = 2500; // kg・m²
            
            // === 6速マニュアルトランスミッション ===
            const gearRatios = [3.635, 2.188, 1.562, 1.194, 1.000, 0.888]; // 実際の86のギア比（6速を0.819→0.850に調整）
            const reverseGearRatio = 3.5; // リバースギア比（バック用）
            const finalDriveRatio = 4.1; // 実際の86のファイナルドライブ比
            
            // グリップパラメータ（超強化版）
            const carGripFront = 1.6; // 前輪グリップ
            const carGripRear = 1.4; // 後輪グリップ
            
            // 状態変数
            if (!car.state) {
                car.state = {
                    vx: 0, vy: 0, yaw: carObject.rotation.y, yawRate: 0,
                    throttle: 0, brake: 0, steer: 0,
                    // エンジン・トランスミッション
                    engineRPM: 0,
                    currentGear: 1,
                    wheelRPM: 0,
                    isBackingUp: false // バック開始フラグ
                };
            }
            const state = car.state;

            // === 入力処理 ===
            // ドライバーレス走行中は入力を無視（状態は固定）
            if (!car.isDriverless) {
                state.throttle = carForward ? 1 : 0;
                
                // Sキーの処理：バック開始フラグを使用
                if (carBackward) {
                    if (!state.isBackingUp) {
                        // バック開始前：速度がある場合はブレーキ、ない場合はバック開始
                        const speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
                        if (speed > 0.5) {
                            // 速度がある場合：ブレーキ処理
                            state.brake = 1;
                            state.throttle = 0;
                        } else {
                            // 速度が0に近い場合：バック開始
                            state.isBackingUp = true;
                            state.brake = 0;
                            state.throttle = -1.0;
                        }
                    } else {
                        // バック中：継続
                        state.brake = 0;
                        state.throttle = -1.0;
                    }
                } else {
                    // Sキーを離した：バック終了
                    state.isBackingUp = false;
                    state.brake = carBrake ? 1 : 0;
                }
                
                let steerInput = 0;
                if (carLeft && !carRight) steerInput = 1;
                else if (carRight && !carLeft) steerInput = -1;
                // ステア補間をdelta時間ベースに（60FPS基準で0.25 → 1秒あたり約18回の補間）
                const steerSmoothRate = 18.0; // 1秒あたりの補間速度
                const steerFactor = 1 - Math.exp(-steerSmoothRate * delta);
                state.steer += (steerInput - state.steer) * steerFactor;
            } else {
                // ドライバーレス走行中：steerを徐々に0に戻す（ハンドル修正）
                // delta時間ベース（60FPS基準で0.08 → 1秒あたり約5回の補間）
                const steerReturnRate = 5.0;
                const steerReturnFactor = 1 - Math.exp(-steerReturnRate * delta);
                state.steer += (0 - state.steer) * steerReturnFactor;
            }

            const speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
            const steerMax = (speed < 10) ? 0.7 : 0.3 + 0.4 * Math.max(0, 1 - (speed - 10) / 50);
            let steerAngle = state.steer * steerMax;
            if (state.vx < 0) steerAngle = -steerAngle;

            // === ホイール RPM を計算 ===
            // 走行速度からホイール回転数を計算（キロ補正：km/h → m/s）
            const speedMS = speed; // m/s
            // バック時は負の速度でも絶対値でRPMを計算
            state.wheelRPM = (Math.abs(state.vx) / (carTireRadius * 2 * Math.PI)) * 60; // RPM
            
            // === ギア比を取得（バック時はRギア） ===
            let gearRatio;
            if (state.throttle < 0) {
                // バック時：リバースギア比を使用
                gearRatio = reverseGearRatio;
            } else {
                // 前進時：通常のギア比
                gearRatio = gearRatios[Math.max(0, Math.min(5, state.currentGear - 1))];
            }
            
            // === エンジン RPM を計算（バック時も上昇） ===
            // エンジン RPM = ホイール RPM × ギア比 × ファイナルドライブ比
            const engineRPMFromWheel = state.wheelRPM * gearRatio * finalDriveRatio;
            state.engineRPM = Math.max(1000, engineRPMFromWheel); // アイドル最小 1000 RPM、上限なし
            
            // === 自動変速ロジック（ギアが一度に複数段上がらないよう制限） ===
            const shiftUpRPM = carMaxRPM * 0.70; // 回転数の70%でシフトアップ（改善：80%から70%に引き下げ）
            const shiftDownRPM = carMaxRPM * 0.40; // 回転数の40%でシフトダウン（改善：25%から40%に引き上げ）
            
            // バック時（throttle < 0）はシフトを禁止し、Rギアに固定
            if (state.throttle >= 0) {
                if (state.engineRPM > shiftUpRPM && state.currentGear < 6) {
                    state.currentGear++;
                } else if (state.engineRPM < shiftDownRPM && state.currentGear > 1) {
                    // シフトダウン条件を改善：スロットルに関わらずギアダウン可能
                    state.currentGear--;
                }
            } else {
                // バック時は1速にリセット（Rギアの計算で使用）
                state.currentGear = 1;
            }
            
            // === 駆動力（トルク曲線最適化） ===
            // 実際の86のトルク特性：1500-6000 RPMで212N・mの高いトルク
            let engineTorque = 0;
            if (state.throttle !== 0) {
                const normalizedRPM = Math.max(1000, Math.abs(state.engineRPM));
                
                // トルク曲線：バック時は低RPMでも最大トルク、前進時は段階的上昇
                let torqueCurve = 1.0;
                
                if (state.throttle < 0) {
                    // バック時：低RPMでも常に最大トルクを出す（簡単加速）
                    torqueCurve = 1.0;
                } else {
                    // 前進時：通常のトルク曲線
                    if (normalizedRPM < 1500) {
                        // 低回転域：1000-1500RPM で段階的に上昇
                        torqueCurve = 0.85 + (normalizedRPM - 1000) / 500 * 0.15; // 0.85 → 1.0
                    } else if (normalizedRPM < 6000) {
                        // ピーク域：1500-6000RPM で常に 1.0（最大トルク212N・m）
                        torqueCurve = 1.0;
                    } else {
                        // 高回転域：6000RPM以降は緩く低下
                        const overRevRatio = (normalizedRPM - 6000) / 1000;
                        torqueCurve = Math.max(0.7, 1.0 - overRevRatio * 0.15);
                    }
                }
                
                // トルク = ピークトルク × トルク曲線 × スロットル
                engineTorque = carMaxTorque * torqueCurve * state.throttle;
            }
            
            // ホイールに伝達されるトルク（ギア比で増幅）
            const wheelTorque = engineTorque * gearRatio * finalDriveRatio;
            let driveForce = wheelTorque / carTireRadius; // F = τ / r
            // バック時（throttle < 0）はより大きな力を許容
            if (state.throttle < 0) {
                // バック時は駆動力の制限を最大まで拡大
                driveForce = Math.max(Math.min(driveForce, 25000), -25000);
            } else {
                driveForce = Math.max(Math.min(driveForce, 16000), -4000);
            }

            // === タイヤ横力（スリップ角に基づく） ===
            const slipAngleFront = Math.atan2(state.vy + carWheelBase / 2 * state.yawRate, Math.max(Math.abs(state.vx), 0.1)) - steerAngle;
            const slipAngleRear = Math.atan2(state.vy - carWheelBase / 2 * state.yawRate, Math.max(Math.abs(state.vx), 0.1));
            
            // スリップ角を制限して飽和させる
            const slipFrontClamped = Math.max(-0.35, Math.min(0.35, slipAngleFront)); // 範囲を拡大
            const slipRearClamped = Math.max(-0.35, Math.min(0.35, slipAngleRear));
            
            const tireForceFront = -Math.sin(slipFrontClamped) * carGripFront * 8000; // 力を大幅に増強
            const tireForceRear = -Math.sin(slipRearClamped) * carGripRear * 8000;

            // === ブレーキ力（適度な減速） ===
            let brakingForce = 0;
            if (state.brake > 0 && speed > 0.1) {
                // ブレーキ力 = 車体速度に応じて、最大 20000 N の制動
                brakingForce = -Math.sign(state.vx) * Math.min(20000, Math.abs(state.vx) * 3000);
            }

            // === 力を合算（車体座標系） ===
            // 前後方向：駆動力とブレーキ力のみ。タイヤ横力は横方向（Y）のみに適用
            const forceX = driveForce + brakingForce;
            // 横方向：前輪ステアリングによるタイヤ横力と後輪横力
            const forceY = tireForceFront * Math.cos(steerAngle) + tireForceRear;

            // === 速度・ヨー角速度の更新 ===
            state.vx += (forceX / carMass) * delta;
            state.vy += (forceY / carMass) * delta;
            
            // 摩擦（リアルな抵抗）- delta時間ベース
            // 減衰率を1秒あたりの残存率として定義し、deltaで補間
            // ドライバーレス走行中はエンジンブレーキを適用（強い抵抗）
            if (car.isDriverless) {
                // 0.97^60 ≈ 0.16（1秒後に16%残存）→ 1秒あたりの減衰率
                const engineBrakeFriction = Math.pow(0.16, delta);
                state.vx *= engineBrakeFriction;
            } else if (state.throttle < 0) {
                // 0.9999^60 ≈ 0.994（1秒後に99.4%残存）
                const backwardFriction = Math.pow(0.994, delta);
                state.vx *= backwardFriction;
            } else {
                // 0.9992^60 ≈ 0.953（1秒後に95.3%残存）
                const forwardFriction = Math.pow(0.953, delta);
                state.vx *= forwardFriction;
            }
            // 横滑り速度の減衰: 0.97^60 ≈ 0.16（1秒後に16%残存）
            const lateralFriction = Math.pow(0.16, delta);
            state.vy *= lateralFriction;
            
            // === バック最高速の制限 ===
            // バック時（state.throttle < 0）の最高速を10km/h（約2.78 m/s）に制限
            const maxBackupSpeed = 2.78; // 10 km/h
            if (state.throttle < 0 && state.vx < -maxBackupSpeed) {
                state.vx = -maxBackupSpeed;
            }
            
            // トルク（Ackermann幾何学に基づく）
            const torque = (carWheelBase / 2) * (tireForceFront * Math.cos(steerAngle) - tireForceRear);
            state.yawRate += (torque / carInertia) * delta;
            // ヨー角速度の減衰: 0.97^60 ≈ 0.16（1秒後に16%残存）- delta時間ベース
            const yawRateFriction = Math.pow(0.16, delta);
            state.yawRate *= yawRateFriction;
            state.yaw += state.yawRate * delta;

            // --- 進行方向ベクトル修正（Three.js標準：Zマイナスが前方） ---
            const forward = new THREE.Vector3(0, 0, -1); // Zマイナスが前
            const right = new THREE.Vector3(1, 0, 0);

            // 車体位置・向きの更新
            // vx: 前後速度, vy: 横滑り速度
            const worldForward = forward.clone().applyAxisAngle(new THREE.Vector3(0,1,0), state.yaw);
            const worldRight = right.clone().applyAxisAngle(new THREE.Vector3(0,1,0), state.yaw);

            carObject.position.add(worldForward.clone().multiplyScalar(state.vx * delta));
            carObject.position.add(worldRight.clone().multiplyScalar(state.vy * delta));
            carObject.rotation.y = state.yaw;

            // === ホイール回転とステアアニメーション ===
            if (!car.userData.wheels) {
                car.userData.wheels = { FL: null, FR: null, RL: null, RR: null };
                carObject.traverse(obj => {
                    if (obj.name === "wheel_FL") car.userData.wheels.FL = obj;
                    if (obj.name === "wheel_FR") car.userData.wheels.FR = obj;
                    if (obj.name === "wheel_RL") car.userData.wheels.RL = obj;
                    if (obj.name === "wheel_RR") car.userData.wheels.RR = obj;
                });
            }
            
            if (!car.userData.wheelTravelDistance) {
                car.userData.wheelTravelDistance = 0;
            }
            
            // ホイール回転更新（走行距離に基づく）
            car.userData.wheelTravelDistance += state.vx * delta;
            const wheelRotationAngle = (car.userData.wheelTravelDistance / carTireRadius) % (Math.PI * 2);
            
            // タイヤメッシュ表示用のステア角（物理計算の反転を打ち消す：見た目は入力通りに）
            const wheelSteerAngle = state.steer * steerMax;
            
            // ホイールメッシュに適用（ステアリングが転がり角度に影響しないよう回転順序を工夫）
            if (car.userData.wheels.FL) {
                car.userData.wheels.FL.rotation.order = 'YXZ';
                car.userData.wheels.FL.rotation.y = wheelSteerAngle; // ステアリング（Y軸）
                car.userData.wheels.FL.rotation.x = wheelRotationAngle; // 転がり（X軸）
                car.userData.wheels.FL.rotation.z = 0; // キャンバー角なし
            }
            if (car.userData.wheels.FR) {
                car.userData.wheels.FR.rotation.order = 'YXZ';
                car.userData.wheels.FR.rotation.y = wheelSteerAngle; // ステアリング（Y軸）
                car.userData.wheels.FR.rotation.x = wheelRotationAngle; // 転がり（X軸）
                car.userData.wheels.FR.rotation.z = 0; // キャンバー角なし
            }
            if (car.userData.wheels.RL) {
                car.userData.wheels.RL.rotation.order = 'YXZ';
                car.userData.wheels.RL.rotation.y = 0; // 後輪はステアリングなし
                car.userData.wheels.RL.rotation.x = wheelRotationAngle; // 転がり（X軸）
                car.userData.wheels.RL.rotation.z = 0; // キャンバー角なし
            }
            if (car.userData.wheels.RR) {
                car.userData.wheels.RR.rotation.order = 'YXZ';
                car.userData.wheels.RR.rotation.y = 0; // 後輪はステアリングなし
                car.userData.wheels.RR.rotation.x = wheelRotationAngle; // 転がり（X軸）
                car.userData.wheels.RR.rotation.z = 0; // キャンバー角なし
            }
            
            // 衝突判定（前方）- 坂道対応版
            // 垂直レイキャスト（地面に沿って移動するため）
            const carFrontPos = carObject.position.clone().add(worldForward.clone().multiplyScalar(0.5)); // 前方0.5のポイント
            const carBackPos = carObject.position.clone().add(worldForward.clone().multiplyScalar(-0.5)); // 後方0.5
            const carRightDir = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), worldForward).normalize();
            const carRightPos = carObject.position.clone().add(carRightDir.clone().multiplyScalar(0.4)); // 右0.4
            const carLeftPos = carObject.position.clone().add(carRightDir.clone().multiplyScalar(-0.4)); // 左0.4
            
            const carDir = worldForward.clone().normalize();
            
            // 水平方向のレイキャスト（壁衝突検出）
            // 衝突判定距離を大幅に短縮（近い障害物のみ反応）
            const carRaycaster = new THREE.Raycaster(
                carFrontPos,
                carDir,
                0,
                Math.max(1.5, Math.abs(state.vx) * 1.5)
            );
            const carIntersects = carRaycaster.intersectObjects(cityCollisionMeshes, true);
            
            // 垂直レイキャスト（地面に沿う高さを検出）
            // 厚さのない平面に対応するため、複数地点からレイキャストして各地点の高さを取得
            const downDir = new THREE.Vector3(0, -1, 0); // 完全に下向き
            const rayCastPoints = [
                { pos: carObject.position.clone(), name: 'center' },
                { pos: carFrontPos.clone(), name: 'front' },
                { pos: carBackPos.clone(), name: 'back' },
                { pos: carRightPos.clone(), name: 'right' },
                { pos: carLeftPos.clone(), name: 'left' }
            ];
            
            let maxGroundHeight = carObject.position.y - 5.0; // デフォルト値（地面がない場合）
            let foundGround = false;
            const groundHeights = {}; // 各地点の地面高さを保存
            
            for (const checkPoint of rayCastPoints) {
                const carDownRaycaster = new THREE.Raycaster(
                    checkPoint.pos.clone().add(new THREE.Vector3(0, 2.0, 0)), // 上方2.0から下向きに検査
                    downDir,
                    0,
                    10.0 // 厚さのない平面対応で範囲を大きく
                );
                const carDownIntersects = carDownRaycaster.intersectObjects(groundCollisionMeshes, true);
                
                if (carDownIntersects.length > 0) {
                    const groundHeight = carDownIntersects[0].point.y;
                    groundHeights[checkPoint.name] = groundHeight;
                    if (groundHeight > maxGroundHeight) {
                        maxGroundHeight = groundHeight;
                    }
                    foundGround = true;
                } else {
                    groundHeights[checkPoint.name] = null;
                }
            }
            
            // 水平衝突判定（壁など）
            // 衝突判定の距離を0.6に短縮、かつ地面メッシュを除外
            // cityCollisionMeshesのみを使用（地面衝突は別途処理）
            if (carIntersects.length > 0 && carIntersects[0].distance < 0.6) {
                // 衝突が地面（Y方向が主）でないことを確認
                const collisionNormal = carIntersects[0].face.normal.clone();
                // 法線がほぼ上向き（Y > 0.7）の場合は地面なので無視
                if (Math.abs(collisionNormal.y) < 0.7) {
                    // 壁などの側面衝突のみ処理
                    state.vx *= -0.15; // バウンス効果（元の15%）
                    state.vy *= 0.3; // 横滑りも大幅に減衰
                    state.yawRate *= 0.5; // ヨー角速度も減衰
                    // 衝突時に車を少し押し戻す
                    carObject.position.add(worldForward.clone().multiplyScalar(-0.15));
                }
            }
            
            // 地面対応（4輪の高さを検出して車体を傾ける）
            if (foundGround && groundCollisionMeshes.length > 0) {
                // 4輪の位置を定義（左右方向はcarRightDir、前後方向はworldForward）
                const wheelDistFront = 1.0; // 前輪位置までの前後距離
                const wheelDistRear = 1.0;  // 後輪位置までの前後距離
                const wheelDistSide = 0.7;  // ホイール左右幅
                
                // 4輪位置の定義
                const wheelCheckPoints = [
                    { pos: carObject.position.clone().add(worldForward.clone().multiplyScalar(wheelDistFront)).add(carRightDir.clone().multiplyScalar(wheelDistSide)), name: 'FL' },
                    { pos: carObject.position.clone().add(worldForward.clone().multiplyScalar(wheelDistFront)).add(carRightDir.clone().multiplyScalar(-wheelDistSide)), name: 'FR' },
                    { pos: carObject.position.clone().add(worldForward.clone().multiplyScalar(-wheelDistRear)).add(carRightDir.clone().multiplyScalar(wheelDistSide)), name: 'RL' },
                    { pos: carObject.position.clone().add(worldForward.clone().multiplyScalar(-wheelDistRear)).add(carRightDir.clone().multiplyScalar(-wheelDistSide)), name: 'RR' }
                ];
                
                const wheelHeights = {};
                let allWheelsOnGround = true;
                
                // 各輪の地面高さを検出
                for (const wheelPoint of wheelCheckPoints) {
                    const wheelRaycaster = new THREE.Raycaster(
                        wheelPoint.pos.clone().add(new THREE.Vector3(0, 3.0, 0)),
                        new THREE.Vector3(0, -1, 0),
                        0,
                        10.0
                    );
                    const wheelIntersects = wheelRaycaster.intersectObjects(groundCollisionMeshes, true);
                    
                    if (wheelIntersects.length > 0) {
                        wheelHeights[wheelPoint.name] = wheelIntersects[0].point.y;
                    } else {
                        wheelHeights[wheelPoint.name] = null;
                        allWheelsOnGround = false;
                    }
                }
                
                // 4輪のうち3輪以上が接地している場合のみ傾斜を計算
                const onGroundCount = Object.values(wheelHeights).filter(h => h !== null).length;
                if (onGroundCount >= 3) {
                    // 車体の中心高さを計算（接地している輪の平均 + 微小なクリアランス）
                    const groundedHeights = Object.values(wheelHeights).filter(h => h !== null);
                    const baseHeight = groundedHeights.reduce((a, b) => a + b, 0) / groundedHeights.length;
                    const centerHeight = baseHeight + 0.05; // 最小限のクリアランス
                    carObject.position.y = centerHeight;
                    
                    // ピッチ角（前後傾き）を計算
                    if (wheelHeights.FL !== null && wheelHeights.RL !== null) {
                        const frontAvg = (wheelHeights.FL + wheelHeights.FR) / 2;
                        const rearAvg = (wheelHeights.RL + wheelHeights.RR) / 2;
                        const heightDiff = frontAvg - rearAvg;
                        const pitchAngle = Math.atan2(heightDiff, wheelDistFront + wheelDistRear);
                        carObject.rotation.x = pitchAngle;
                    }
                    
                    // ロール角（左右傾き）を計算
                    if (wheelHeights.FL !== null && wheelHeights.FR !== null) {
                        const leftAvg = (wheelHeights.FL + wheelHeights.RL) / 2;
                        const rightAvg = (wheelHeights.FR + wheelHeights.RR) / 2;
                        const heightDiff = leftAvg - rightAvg;
                        const rollAngle = Math.atan2(heightDiff, wheelDistSide * 2);
                        
                        // ロール角と物理的なロール（ヨー時）の合算
                        if (!car.userData.suspensionRoll) car.userData.suspensionRoll = 0;
                        const rollCoef = 0.08;
                        const maxRoll = Math.PI / 12;
                        const rollTarget = THREE.MathUtils.clamp(-state.yawRate * rollCoef, -maxRoll, maxRoll);
                        car.userData.suspensionRoll += (rollTarget - car.userData.suspensionRoll) * 0.1;
                        
                        carObject.rotation.z = rollAngle + car.userData.suspensionRoll;
                    }
                }
            }
            
            // 衝突判定（後方）
            const carBackCheckPos = carObject.position.clone().add(worldForward.clone().multiplyScalar(-1.0)); // 後面から発射
            const carBackDir = worldForward.clone().multiplyScalar(-1).normalize();
            const carBackRaycaster = new THREE.Raycaster(
                carBackCheckPos,
                carBackDir,
                0,
                Math.max(1.5, Math.abs(state.vx) * 1.5)
            );
            const carBackIntersects = carBackRaycaster.intersectObjects(cityCollisionMeshes, true);
            // 後方衝突判定も距離を短縮、地面を除外
            if (carBackIntersects.length > 0 && carBackIntersects[0].distance < 0.6) {
                const collisionNormal = carBackIntersects[0].face.normal.clone();
                if (Math.abs(collisionNormal.y) < 0.7) {
                    // 衝突時は速度を大幅に減衰
                    state.vx *= -0.15; // バウンス効果（元の15%）
                    state.vy *= 0.3; // 横滑りも大幅に減衰
                    state.yawRate *= 0.5; // ヨー角速度も減衰
                    // 衝突時に車を少し押し戻す
                    carObject.position.add(worldForward.clone().multiplyScalar(0.15));
                }
            }

            const speedKmh = speed * 3.6;
            // バック時は「R」、前進時はギア番号を表示
            const gearDisplay = state.throttle < 0 ? 'R' : state.currentGear;
            const rpmDisplay = Math.round(state.engineRPM);
            
            // スピードメーター＋タコメーター表示（ゲージのような表示）
            const speedBar = Math.min(30, speedKmh) / 30; // 0-300km/hのスケール (表示上30km/hまで)
            const rpmBar = Math.min(7000, state.engineRPM) / 7000; // 0-7000 RPMのスケール
            
            const speedBarLength = Math.round(speedBar * 20);
            const rpmBarLength = Math.round(rpmBar * 20);
            
            const speedBarStr = '█'.repeat(speedBarLength) + '░'.repeat(20 - speedBarLength);
            const rpmBarStr = '█'.repeat(rpmBarLength) + '░'.repeat(20 - rpmBarLength);
            
            speedDiv.innerText = 
                `SPEED\n${Math.round(speedKmh).toString().padStart(3)} km/h\n${speedBarStr}\n\n` +
                `RPM\n${rpmDisplay.toString().padStart(4)} rpm\n${rpmBarStr}\n\n` +
                `Gear: ${gearDisplay}`;
            // 乗車中のみ表示
            speedDiv.style.display = isCarMode ? 'block' : 'none';
            
            // === エンジン音更新（距離ベースの3Dオーディオ） ===
            updateEngineAudio(state.engineRPM, state.throttle, carObject.position, camera.position);
            
            // 車両回転情報を表示
            const euler = new THREE.Euler();
            euler.setFromQuaternion(carObject.quaternion, 'YXZ');
            const pitchDeg = THREE.MathUtils.radToDeg(euler.x);
            const rollDeg = THREE.MathUtils.radToDeg(euler.z);
            const yawDeg = THREE.MathUtils.radToDeg(euler.y);
            
            rotationDiv.style.display = isCarMode ? 'block' : 'none';

            // コライダーは子要素として追加されているため、位置同期は不要（自動的に親に追従）

            // --- カメラ追従修正 ---
            if (isCarMode) {
                const carPos = carObject.position.clone();
                const cameraDir = worldForward.clone();
                cameraDir.y = 0;
                cameraDir.normalize();

                if (carViewMode === 1) {
                    const targetOffset = cameraDir.clone().multiplyScalar(-6).add(new THREE.Vector3(0, 3, 0));
                    const targetPos = carPos.clone().add(targetOffset);

                    // カメラ追従をdelta時間ベースに（FPS非依存）
                    // 60FPSで0.04 → 1秒あたり約2.5回の補間速度
                    const camFollowRateXZ = 2.5;
                    const camFollowRateY = 12.0; // 60FPSで0.18 → 1秒あたり約12回
                    const camFactorXZ = 1 - Math.exp(-camFollowRateXZ * delta);
                    const camFactorY = 1 - Math.exp(-camFollowRateY * delta);
                    
                    cameraFollowPos.x += (targetPos.x - cameraFollowPos.x) * camFactorXZ;
                    cameraFollowPos.z += (targetPos.z - cameraFollowPos.z) * camFactorXZ;
                    cameraFollowPos.y += (targetPos.y - cameraFollowPos.y) * camFactorY;

                    // === カメラコリジョン処理：建物貫通防止 ===
                    // カメラ位置から車位置へのレイキャストで壁をチェック
                    const raycaster = new THREE.Raycaster();
                    const rayDir = carPos.clone().sub(cameraFollowPos).normalize();
                    const rayLength = cameraFollowPos.distanceTo(carPos);
                    
                    raycaster.set(cameraFollowPos, rayDir);
                    const intersects = raycaster.intersectObjects(cityCollisionMeshes, true);
                    
                    if (intersects.length > 0 && intersects[0].distance < rayLength) {
                        // 壁に当たった場合、カメラを壁の手前に配置
                        const hitPoint = intersects[0].point;
                        const offset = rayDir.clone().multiplyScalar(-0.5); // 壁から0.5m手前
                        cameraFollowPos.copy(hitPoint.clone().add(offset));
                    }

                    camera.position.copy(cameraFollowPos);
                    camera.lookAt(carPos);
                } else if (carViewMode === 2) {
                    const cameraOffset = cameraDir.clone().multiplyScalar(0).add(new THREE.Vector3(0.45, 1.35, 0));
                    camera.position.copy(carPos.clone().add(cameraOffset));
                    camera.lookAt(carPos.clone().add(cameraDir.clone().multiplyScalar(10)));
                }
            }

            // Bloom効果付きでレンダリング
            composer.render();
        }
        
        // マズルフラッシュの更新処理
        for (let i = muzzleFlashEffects.length - 1; i >= 0; i--) {
            const flash = muzzleFlashEffects[i];
            const elapsed = Date.now() - flash.startTime;
            const progress = elapsed / flash.duration; // 0～1
            
            if (progress >= 1) {
                // マズルフラッシュ終了
                scene.remove(flash.particles);
                scene.remove(flash.flashMesh);
                // 追跡配列からも削除
                const particlesIdx = impactEffectObjects.indexOf(flash.particles);
                if (particlesIdx > -1) impactEffectObjects.splice(particlesIdx, 1);
                const meshIdx = impactEffectObjects.indexOf(flash.flashMesh);
                if (meshIdx > -1) impactEffectObjects.splice(meshIdx, 1);
                muzzleFlashEffects.splice(i, 1);
                continue;
            }
            
            // パーティクルの前方拡散
            const positionArray = flash.particles.geometry.attributes.position.array;
            const particleCount = positionArray.length / 3;
            const expandDistance = progress * 0.2;
            
            for (let j = 0; j < particleCount; j++) {
                const initialX = flash.initialPositions[j * 3];
                const initialY = flash.initialPositions[j * 3 + 1];
                const initialZ = flash.initialPositions[j * 3 + 2];
                
                const particlePos = new THREE.Vector3(initialX, initialY, initialZ);
                const center = flash.particles.position;
                const direction = particlePos.clone().sub(center).normalize();
                const bulletDir = flash.direction.clone();
                
                // 拡散方向：銃の向き + 外側への拡散
                const mixedDir = direction.clone().add(bulletDir.multiplyScalar(0.5)).normalize();
                
                positionArray[j * 3] = initialX + mixedDir.x * expandDistance;
                positionArray[j * 3 + 1] = initialY + mixedDir.y * expandDistance;
                positionArray[j * 3 + 2] = initialZ + mixedDir.z * expandDistance;
            }
            flash.particles.geometry.attributes.position.needsUpdate = true;
            
            // フラッシュのフェードアウトと縮小
            flash.flashMesh.material.opacity = 0.9 * (1 - progress);
            flash.flashMesh.scale.set(1 + progress * 0.5, 1 + progress * 0.5, 1 + progress * 0.5);
        }
        
        // 弾道線の更新処理
        for (let i = bulletTrails.length - 1; i >= 0; i--) {
            const trail = bulletTrails[i];
            const elapsed = Date.now() - trail.startTime;
            const progress = elapsed / trail.duration; // 0～1
            
            if (progress >= 1) {
                // 弾道線を削除
                scene.remove(trail.line);
                bulletTrails.splice(i, 1);
                continue;
            }
            
            // 弾道線のフェードアウト
            trail.line.material.opacity = 1 - progress;
            trail.line.material.transparent = true;
        }
        
        // 着弾エフェクトの更新処理
        for (let i = impactEffects.length - 1; i >= 0; i--) {
            const effect = impactEffects[i];
            const elapsed = Date.now() - effect.startTime;
            const progress = elapsed / effect.duration; // 0～1
            
            if (progress >= 1) {
                // エフェクト終了
                scene.remove(effect.particles);
                scene.remove(effect.explosionMesh);
                // 追跡配列からも削除
                const particlesIdx = impactEffectObjects.indexOf(effect.particles);
                if (particlesIdx > -1) impactEffectObjects.splice(particlesIdx, 1);
                const meshIdx = impactEffectObjects.indexOf(effect.explosionMesh);
                if (meshIdx > -1) impactEffectObjects.splice(meshIdx, 1);
                impactEffects.splice(i, 1);
                continue;
            }
            
            // パーティクルの拡散アニメーション
            const positionArray = effect.particles.geometry.attributes.position.array;
            const particleCount = positionArray.length / 3;
            const expandDistance = progress * 0.3;
            
            for (let j = 0; j < particleCount; j++) {
                const initialX = effect.initialPositions[j * 3];
                const initialY = effect.initialPositions[j * 3 + 1];
                const initialZ = effect.initialPositions[j * 3 + 2];
                
                // 初期位置から中心へのベクトル
                const particlePos = new THREE.Vector3(initialX, initialY, initialZ);
                const center = effect.particles.position;
                const direction = particlePos.clone().sub(center).normalize();
                
                positionArray[j * 3] = initialX + direction.x * expandDistance;
                positionArray[j * 3 + 1] = initialY + direction.y * expandDistance;
                positionArray[j * 3 + 2] = initialZ + direction.z * expandDistance;
            }
            effect.particles.geometry.attributes.position.needsUpdate = true;
            
            // 爆破メッシュのフェードアウト
            effect.explosionMesh.material.opacity = 0.8 * (1 - progress);
            effect.explosionMesh.scale.set(1 + progress, 1 + progress, 1 + progress);
        }

        // ミニマップを描画
        drawMinimap();
        
        // すべての車のコライダーを同期
        cars.forEach((car, index) => {
            if (car.object && car.colliderObject) {
                // 位置・回転を直接代入するのではなく、スムーズに補間して追従させる
                const lerpAlpha = 0.5;
                car.colliderObject.position.lerp(car.object.position, lerpAlpha);
                car.colliderObject.quaternion.slerp(car.object.quaternion, lerpAlpha);
            }
        });

        // ===== 物理オブジェクトの更新 =====
        updatePhysicsObjects(delta);
    }

    // 物理オブジェクト更新関数
    function updatePhysicsObjects(delta) {
        if (physicsObjects.length === 0) return;

        physicsObjects.forEach((physObj) => {
            if (!physObj.object) return;

            // 生成直後のカウント
            if (physObj.isSpawning) {
                physObj.spawnFrameCount += delta; // 秒単位で加算
                // 0.2秒後に生成状態を解除
                if (physObj.spawnFrameCount > 0.2) {
                    physObj.isSpawning = false;
                    physObj.spawnFrameCount = 0;
                    // 生成直後の地面判定が完了したら、初期配置フラグを解除
                    if (physObj.needsInitialPositioning) {
                        physObj.needsInitialPositioning = false;
                    }
                }
            }

            // 車との衝突検出
            cars.forEach((car) => {
                if (!car.object) return;

                const distance = physObj.object.position.distanceTo(car.object.position);
                const collisionDistance = 2.5; // 衝突判定距離

                if (distance < collisionDistance) {
                    // 衝突発生：物理オブジェクトに速度を付与
                    const carSpeed = Math.sqrt(car.state.vx ** 2 + car.state.vy ** 2);
                    
                    if (carSpeed > 0.5) {
                        const carMass = 1250; // 車の質量（kg）
                        
                        // 車の進行方向ベクトル
                        const forward = new THREE.Vector3(0, 0, -1);
                        const carForward = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), car.state.yaw);

                        // 衝突方向（車からオブジェクトへ）
                        const collisionDir = physObj.object.position.clone().sub(car.object.position).normalize();

                        // 衝突時の速度計算（より現実的なアプローチ）
                        // GTA5レベルの吹っ飛び効果：衝突時間を考慮した加速度ベース
                        // 衝突時間を仮定：約0.1秒の接触時間
                        const collisionTime = 0.1; // 秒
                        
                        // 車がオブジェクトに与える力：F = (m × v) / t
                        // ただし、実際の衝突では力の大部分は相互に相殺される
                        // オブジェクト側が受ける加速度：a = (m_car / (m_car + m_obj)) × (v_car / t)
                        const massRatio = carMass / (carMass + physObj.mass); // 質量比（0.96程度）
                        const acceleration = massRatio * (carSpeed / collisionTime); // 加速度
                        
                        // 最大加速度を制限（9Gまで、現実的）
                        const maxAcceleration = 9 * 9.81; // 9G = 88.3 m/s²
                        const limitedAcceleration = Math.min(acceleration, maxAcceleration);
                        
                        // 衝突時間分の速度増加
                        const acquiredSpeed = limitedAcceleration * collisionTime;
                        
                        physObj.velocity.addScaledVector(collisionDir, acquiredSpeed);
                        
                        // 上方向の速度も付与（吹っ飛ぶ効果、速度に比例）
                        physObj.velocity.y += Math.abs(acquiredSpeed) * 0.5;

                        // 回転速度も付与
                        const randomAxis = new THREE.Vector3(
                            Math.random() - 0.5,
                            Math.random() - 0.5,
                            Math.random() - 0.5
                        ).normalize();
                        physObj.angularVelocity.addScaledVector(randomAxis, acquiredSpeed * 0.5);
                        
                        physObj.isActive = true;
                    }
                }
            });

            // 重力適用
            physObj.velocity.y += physObj.gravity * delta;

            // 速度を位置に反映
            physObj.object.position.addScaledVector(physObj.velocity, delta);

            // 回転を適用
            const angularVelLength = physObj.angularVelocity.length();
            if (angularVelLength > 0.001) {
                const rotationAxis = physObj.angularVelocity.clone().normalize();
                const rotationAngle = angularVelLength * delta;
                const quat = new THREE.Quaternion();
                quat.setFromAxisAngle(rotationAxis, rotationAngle);
                physObj.object.quaternion.multiplyQuaternions(quat, physObj.object.quaternion);
            }

            // 速度と回転速度の減衰
            physObj.velocity.multiplyScalar(physObj.friction);
            physObj.angularVelocity.multiplyScalar(0.95);

            // 街（壁）との衝突判定
            if (cityCollisionMeshes.length > 0) {
                // バウンディングボックスをコライダーメッシュから計算（回転に影響されない）
                if (physObj.colliderMeshes && physObj.colliderMeshes.length > 0) {
                    physObj.boundingBox = getColliderBoundingBox(physObj.colliderMeshes);
                } else {
                    if (!physObj.boundingBox) {
                        physObj.boundingBox = new THREE.Box3();
                    }
                    physObj.boundingBox.setFromObject(physObj.object);
                }
                
                const checkPoints = [
                    physObj.object.position.clone(),
                    physObj.object.position.clone().add(new THREE.Vector3(0.5, 0, 0)),
                    physObj.object.position.clone().add(new THREE.Vector3(-0.5, 0, 0)),
                    physObj.object.position.clone().add(new THREE.Vector3(0, 0, 0.5)),
                    physObj.object.position.clone().add(new THREE.Vector3(0, 0, -0.5))
                ];

                for (const checkPoint of checkPoints) {
                    // 水平方向の速度のみでレイキャスト（Y方向は無視）
                    const horizontalVel = new THREE.Vector3(physObj.velocity.x, 0, physObj.velocity.z);
                    const velLength = horizontalVel.length();
                    
                    if (velLength > 0.01) { // 水平速度がある場合のみ衝突判定
                        const velocityDir = horizontalVel.clone().normalize();
                        const rayLength = Math.min(velLength * delta * 2, 0.5);
                        
                        const raycaster = new THREE.Raycaster(checkPoint, velocityDir, 0, rayLength);
                        const intersects = raycaster.intersectObjects(cityCollisionMeshes, true);

                        if (intersects.length > 0) {
                            // 衝突検出：水平速度のみを反射
                            const hitNormal = intersects[0].face.normal.clone();
                            hitNormal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(intersects[0].object.matrixWorld));

                            // 法線のY成分を確認（壁か床/天井かの判定）
                            const isWall = Math.abs(hitNormal.y) < 0.5; // Y成分が小さい = 壁
                            
                            if (isWall) {
                                // 壁との衝突：水平方向のみを反射、Y速度は完全に無視
                                const restitution = 0.4;
                                
                                // 水平法線を計算（Y成分を0にして正規化）
                                const wallNormal = new THREE.Vector3(hitNormal.x, 0, hitNormal.z).normalize();
                                
                                // 水平速度の反射
                                const horizontalVelReflect = new THREE.Vector3(physObj.velocity.x, 0, physObj.velocity.z);
                                const dotProduct = horizontalVelReflect.dot(wallNormal);
                                if (dotProduct < 0) {
                                    const reflectionForce = wallNormal.clone().multiplyScalar(-2 * dotProduct * restitution);
                                    physObj.velocity.x = reflectionForce.x;
                                    physObj.velocity.z = reflectionForce.z;
                                }

                                // オブジェクトを衝突面から離す（バウンディングボックス考慮）
                                // 壁の法線方向にバウンディングボックスの半幅だけ移動
                                const bbSize = physObj.boundingBox.getSize(new THREE.Vector3());
                                const bbHalfWidth = Math.max(Math.abs(wallNormal.x) * bbSize.x, Math.abs(wallNormal.z) * bbSize.z) / 2;
                                const pushDistance = Math.max(0.15, bbHalfWidth + 0.05); // 最小0.15、バウンディングボックス+0.05のマージン
                                
                                physObj.object.position.addScaledVector(wallNormal.clone(), pushDistance);
                                
                                physObj.isActive = true;
                                break; // 最初の衝突のみ処理
                            }
                        }
                    }
                }
            }

            // 地面との衝突判定（落下の停止）- 誤検出防止版
            // 生成直後は判定をスキップ、ただし初期位置設定時は実行
            if (groundCollisionMeshes.length > 0 && (physObj.needsInitialPositioning || !physObj.isSpawning)) {
                // オブジェクトの中心座標を取得
                const objCenterX = physObj.object.position.x;
                const objCenterZ = physObj.object.position.z;
                const objCenterY = physObj.object.position.y;
                
                // オブジェクトの実際の最下点を推定（回転している場合も考慮）
                // 簡易的に固定の高さを使用（人型モデルの場合約1m）
                const estimatedHalfHeight = 1.0;
                
                // レイキャスト開始位置：オブジェクトの中心から少し下（屋根を誤検出しない）
                const rayStartY = physObj.needsInitialPositioning ? objCenterY + 10 : objCenterY;
                const rayOrigin = new THREE.Vector3(objCenterX, rayStartY, objCenterZ);
                const downDir = new THREE.Vector3(0, -1, 0);
                
                // レイの長さを制限（初期配置時は長く、通常時は短く）
                const rayLength = physObj.needsInitialPositioning ? 50.0 : (estimatedHalfHeight + 2.0);
                const raycaster = new THREE.Raycaster(rayOrigin, downDir, 0, rayLength);
                
                const intersects = raycaster.intersectObjects(groundCollisionMeshes, true);
                let groundY = null;
                
                if (intersects.length > 0) {
                    groundY = intersects[0].point.y;
                }
                
                // デバッグ：地面検出状況をログ出力（5秒に1回程度の頻度）
                if (!physObj.lastDebugTime) physObj.lastDebugTime = 0;
                physObj.lastDebugTime += delta;
                if (physObj.lastDebugTime > 5) {
                    // デバッグログ削除（軽量化）
                    physObj.lastDebugTime = 0;
                }
                
                // 地面が検出された場合、オブジェクトを地面の上に配置
                if (groundY !== null) {
                    const minDistanceToGround = 0.05; // 地面からの最小距離
                    
                    // オブジェクトの最下点を地面に合わせる
                    const targetCenterY = groundY + minDistanceToGround + estimatedHalfHeight;
                    
                    // 初期位置設定時は一度で配置
                    if (physObj.needsInitialPositioning) {
                        physObj.object.position.y = targetCenterY;
                        physObj.needsInitialPositioning = false;
                    } else {
                        // オブジェクトが地面より下にある場合のみ押し上げる
                        const currentBottomY = objCenterY - estimatedHalfHeight;
                        if (currentBottomY < groundY + minDistanceToGround) {
                            physObj.object.position.y = targetCenterY;
                            
                            // 下方向の速度をリセット
                            if (physObj.velocity.y < 0) {
                                physObj.velocity.y = 0;
                            }
                            
                            // 地面摩擦による減衰
                            const speed = physObj.velocity.length();
                            if (speed < 0.5) {
                                physObj.velocity.multiplyScalar(0.9);
                                physObj.angularVelocity.multiplyScalar(0.85);
                            }
                            
                            physObj.isGrounded = true;
                        } else {
                            // 地面より上にいる場合は接地していない
                            physObj.isGrounded = false;
                        }
                    }
                    
                    physObj.groundFrameCount = physObj.isGrounded ? 3 : 0;
                } else {
                    // 地面が見つからない場合
                    physObj.isGrounded = false;
                    physObj.groundFrameCount = 0;
                    // Y速度の下限を設定して極端な落下を防止
                    physObj.velocity.y = Math.max(physObj.velocity.y, -20.0);
                }
            }

        });
    }

    // ミニマップ描画関数
    function drawMinimap() {
        // プレイヤー/車の位置を取得
        let playerPos;
        const activeCar = getActiveCar();
        if (isCarMode && activeCar && activeCar.object) {
            playerPos = activeCar.object.position;
        } else {
            playerPos = controls.getObject().position;
        }

        // ミニマップカメラの位置をプレイヤーの上に配置
        minimapCamera.position.x = playerPos.x;
        minimapCamera.position.z = playerPos.z;
        minimapCamera.lookAt(playerPos.x, 0, playerPos.z);

        // ミニマップをレンダリングターゲットに描画
        renderer.setRenderTarget(minimapRenderTarget);
        renderer.render(scene, minimapCamera);
        renderer.setRenderTarget(null);

        // レンダリングターゲットをキャンバスに描画
        const pixelData = new Uint8Array(minimapWidth * minimapHeight * 4);
        renderer.readRenderTargetPixels(minimapRenderTarget, 0, 0, minimapWidth, minimapHeight, pixelData);

        const imageData = minimapCtx.createImageData(minimapWidth, minimapHeight);
        // WebGLはY軸が反転しているため補正
        for (let i = 0; i < minimapHeight; i++) {
            const srcOffset = i * minimapWidth * 4;
            const dstOffset = (minimapHeight - 1 - i) * minimapWidth * 4;
            imageData.data.set(pixelData.subarray(srcOffset, srcOffset + minimapWidth * 4), dstOffset);
        }

        minimapCtx.putImageData(imageData, 0, 0);

        // プレイヤーマーカーを描画
        const centerX = minimapWidth / 2;
        const centerY = minimapHeight / 2;

        // プレイヤーの位置マーカー
        minimapCtx.fillStyle = isCarMode ? 'rgba(0, 255, 0, 0.7)' : 'rgba(0, 170, 255, 0.7)';
        minimapCtx.beginPath();
        minimapCtx.arc(centerX, centerY, 5, 0, Math.PI * 2);
        minimapCtx.fill();

        // 向き矢印
        let direction;
        if (isCarMode && activeCar && activeCar.object) {
            direction = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), activeCar.object.rotation.y);
        } else {
            direction = new THREE.Vector3();
            controls.getDirection(direction);
        }

        minimapCtx.strokeStyle = isCarMode ? 'rgba(0, 255, 0, 0.9)' : 'rgba(0, 170, 255, 0.9)';
        minimapCtx.lineWidth = 2;
        minimapCtx.beginPath();
        minimapCtx.moveTo(centerX, centerY);
        minimapCtx.lineTo(centerX + direction.x * 15, centerY + direction.z * 15);
        minimapCtx.stroke();

        // 外枠
        minimapCtx.strokeStyle = '#fff';
        minimapCtx.lineWidth = 2;
        minimapCtx.strokeRect(0, 0, minimapWidth, minimapHeight);
    }

    let lastTime = performance.now();
    let frames = 0;
    let fps = 0;
    animate();
}
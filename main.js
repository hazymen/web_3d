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

    // レンダラーを作成
    const canvasElement = document.querySelector('#myCanvas');
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        canvas: canvasElement,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;

    // シーンを作成
    const scene = new THREE.Scene();

    // カメラを作成
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(-10, 1.6, -25); // 一人称視点の高さ

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

    // 環境光源を作成
    const ambientLight = new THREE.AmbientLight(0xffffff);
    ambientLight.intensity = 0.4;
    ambientLight.position.set(200,200,200)
    scene.add(ambientLight);

    // 太陽光（DirectionalLight）の追加
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2); // 色と強さ
    sunLight.position.set(500, 1000, 500); // 太陽の位置（高い位置に設定）
    sunLight.castShadow = true; // 影を有効化
    sunLight.shadow.mapSize.width = 4096;
    sunLight.shadow.mapSize.height = 4096;
    
    // 影の範囲を広げる（ここを追加・調整）
    sunLight.shadow.camera.left = -500;
    sunLight.shadow.camera.right = 500;
    sunLight.shadow.camera.top = 500;
    sunLight.shadow.camera.bottom = -500;
    sunLight.shadow.camera.near = 1; //影の最短描画範囲
    sunLight.shadow.camera.far = 2000; //影の最長描画範囲

    sunLight.shadow.bias = -0.001;
    
    scene.add(sunLight);
   

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


    const skyGeometry = new THREE.SphereGeometry(1000, 8, 8);
    const skyMaterial = new THREE.MeshBasicMaterial({
        color: 0x87ceeb, // 空色
        side: THREE.BackSide // 内側を表示
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(sky);

    let isJumping = false;
    let velocityY = 0;
    const gravity = -0.0035;      // 重力加速度（マイナス値）
    const jumpAccel = 0.008;      // ジャンプ時に加える加速度
    const jumpDuration = 20;     // ジャンプ加速を加えるフレーム数
    let jumpFrame = 0;
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
    function loadPhysicsModel(modelName, position, colliderName) {
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
                mass: 5, // kg
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
                userData: {}
            };

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
                // コンソールに出力して、ユーザーが確認できるようにする
                console.log(`[${objName}] Geometry Center: (${geometryCenter.x.toFixed(2)}, ${geometryCenter.y.toFixed(2)}, ${geometryCenter.z.toFixed(2)})`);
                console.log(`[${objName}] Current Offset: (${offset.x}, ${offset.y}, ${offset.z})`);
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
                
                console.log(`[${objName}] Final Offset Applied: (${finalOffset.x.toFixed(2)}, ${finalOffset.y.toFixed(2)}, ${finalOffset.z.toFixed(2)})`);
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
                        
                        console.log(`[${objName}] Final Offset Applied (delayed): (${finalOffset.x.toFixed(2)}, ${finalOffset.y.toFixed(2)}, ${finalOffset.z.toFixed(2)})`);
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
                console.log(`[DEBUG] Car positioned at ground Y=${groundY} (detected=${intersects[0].point.y})`);
            } else {
                console.log(`[DEBUG] No ground detected at (${x}, ${z})`);
            }
        } else {
            console.log(`[DEBUG] groundCollisionMeshes is empty!`);
        }
        
        // 車をその地面の上に配置
        carObject.position.y = groundY;
    }

    // loadOBJModel('ak47.obj', { x: 0, y: 1, z: 0 });
    loadPhysicsModel('120.glb', { x: 3, y: 2, z: 0 }, '120_collider.obj');

    loadGLBModel("120.glb", {x:0,y:0,z:90});
    loadGLBModel("119.glb", {x:3,y:0,z:96});
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

    // city.glb自体は見た目用として配置（衝突判定も有効）
    function loadCityModel(modelName, position) {
        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.load(`models/${modelName}`, function(gltf) {
            gltf.scene.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.frustumCulled = true;
                    // 町のモデルのメッシュを当たり判定用に追加（city_collider.objの代わり）
                    cityCollisionMeshes.push(child);
                }
            });
            gltf.scene.position.set(position.x, position.y, position.z);
            gltf.scene.scale.set(1, 1, 1);
            scene.add(gltf.scene);
        });
    }

    // --- 読み込み呼び出し例 ---
    loadCityModel('city3.glb', { x: 0, y: 0.01, z: 0 });
    // loadCityColliderOBJ('city_collider.obj', { x: 0, y: 0.01, z: 0 }); // 無効化

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
            console.log(`[DEBUG] city_ground.glb loaded: ${meshCount} meshes added to groundCollisionMeshes. Total: ${groundCollisionMeshes.length}`);
            gltf.scene.position.set(position.x, position.y, position.z);
            gltf.scene.scale.set(1, 1, 1);
            scene.add(gltf.scene);
        });
    }

    // 地面を読み込む
    loadGroundModel('city_ground.glb', { x: 0, y: 0.01, z: 0 });

    // --- 衝突判定: cityCollisionMeshes は壁用、groundCollisionMeshes は地面用 ---


    // Fキーで乗車・降車切り替え
    document.addEventListener('keydown', (event) => {
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
                }
            } else if (isCarMode && activeCarIndex >= 0) {
                // 車モード時、降りる
                isCarMode = false;
                rotationDiv.style.display = 'none'; // 回転情報表示を非表示
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
                }
                activeCarIndex = -1;
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
                            velocityY = 0;
                            jumpFrame = 0;
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
                
                // 物理オブジェクトへのダメージ判定
                for (const physObj of physicsObjects) {
                    if (physObj.colliderMeshes && physObj.colliderMeshes.length > 0) {
                        // 衝突判定：hitPointが物理オブジェクトのバウンディングボックス内か確認
                        const bbox = getColliderBoundingBox(physObj.colliderMeshes);
                        if (bbox.containsPoint(hitPoint)) {
                            // 物理オブジェクトに対して銃弾の衝撃を与える
                            const impactForce = cameraDir.clone().multiplyScalar(15); // 銃弾の威力
                            physObj.velocity.add(impactForce);
                            
                            // 回転も追加（ランダムな軸）
                            const randomAxis = new THREE.Vector3(
                                Math.random() - 0.5,
                                Math.random() - 0.5,
                                Math.random() - 0.5
                            ).normalize();
                            physObj.angularVelocity.add(randomAxis.multiplyScalar(8));
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
    let moveSpeed = 0.12; // 走り速度に変更

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
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
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
            camera.position.set(0, 200, 0);
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
                if (jumpFrame < jumpDuration) {
                    velocityY += jumpAccel;
                    jumpFrame++;
                }
                velocityY += gravity;
                obj.position.y += velocityY;
                
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
                // 射撃中は移動速度を3分の1に制限
                const currentMoveSpeed = isShooting ? moveSpeed / 3 : moveSpeed;
                const nextPos = currentPos.clone().add(moveVec.clone().multiplyScalar(currentMoveSpeed));
                if (canMove(nextPos)) {
                    controls.getObject().position.copy(nextPos);
                }
            }

            // 銃の配置（走り動作を含む）
            if (gunLoaded && gunObject) {
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
                
                gunObject.visible = true;
            }

            renderer.render(scene, camera);
        } else if (isCarMode && gunLoaded && gunObject) {
            // 車モード時は銃を非表示
            gunObject.visible = false;
        }
        if (isCarMode && activeCarIndex >= 0 && activeCarIndex < cars.length) {
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
            state.steer += (steerInput - state.steer) * 0.25;

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
            
            // 摩擦（リアルな抵抗）
            // バック時はさらに摩擦を削減
            if (state.throttle < 0) {
                state.vx *= 0.9999; // バック時は極めて低い抵抗
            } else {
                state.vx *= 0.9992; // 前進時の摩擦
            }
            state.vy *= 0.97; // 横滑り速度の減衰
            
            // === バック最高速の制限 ===
            // バック時（state.throttle < 0）の最高速を10km/h（約2.78 m/s）に制限
            const maxBackupSpeed = 2.78; // 10 km/h
            if (state.throttle < 0 && state.vx < -maxBackupSpeed) {
                state.vx = -maxBackupSpeed;
            }
            
            // トルク（Ackermann幾何学に基づく）
            const torque = (carWheelBase / 2) * (tireForceFront * Math.cos(steerAngle) - tireForceRear);
            state.yawRate += (torque / carInertia) * delta;
            state.yawRate *= 0.97; // ヨー角速度の減衰を弱める
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
            speedDiv.style.display = 'block';
            
            // === エンジン音更新（距離ベースの3Dオーディオ） ===
            updateEngineAudio(state.engineRPM, state.throttle, carObject.position, camera.position);
            
            // 車両回転情報を表示
            const euler = new THREE.Euler();
            euler.setFromQuaternion(carObject.quaternion, 'YXZ');
            const pitchDeg = THREE.MathUtils.radToDeg(euler.x);
            const rollDeg = THREE.MathUtils.radToDeg(euler.z);
            const yawDeg = THREE.MathUtils.radToDeg(euler.y);
            
            rotationDiv.style.display = 'block';
            rotationDiv.innerText = 
                `Pitch: ${pitchDeg.toFixed(1)}°\n` +
                `Roll: ${rollDeg.toFixed(1)}°\n` +
                `Yaw: ${yawDeg.toFixed(1)}°`;

            // コライダーは子要素として追加されているため、位置同期は不要（自動的に親に追従）

            // --- カメラ追従修正 ---
            const carPos = carObject.position.clone();
            const cameraDir = worldForward.clone();
            cameraDir.y = 0;
            cameraDir.normalize();

            if (carViewMode === 1) {
                const targetOffset = cameraDir.clone().multiplyScalar(-6).add(new THREE.Vector3(0, 3, 0));
                const targetPos = carPos.clone().add(targetOffset);

                cameraFollowPos.x += (targetPos.x - cameraFollowPos.x) * 0.04;
                cameraFollowPos.z += (targetPos.z - cameraFollowPos.z) * 0.04;
                cameraFollowPos.y += (targetPos.y - cameraFollowPos.y) * 0.18;

                camera.position.copy(cameraFollowPos);
                camera.lookAt(carPos);
            } else if (carViewMode === 2) {
                const cameraOffset = cameraDir.clone().multiplyScalar(0).add(new THREE.Vector3(0.45, 1.35, 0));
                camera.position.copy(carPos.clone().add(cameraOffset));
                camera.lookAt(carPos.clone().add(cameraDir.clone().multiplyScalar(10)));
            }

            renderer.render(scene, camera);
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
                physObj.spawnFrameCount++;
                // 10フレーム後に生成状態を解除（この間は地面判定をスキップ）
                if (physObj.spawnFrameCount > 10) {
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
                        // 車の進行方向ベクトル
                        const forward = new THREE.Vector3(0, 0, -1);
                        const carForward = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), car.state.yaw);

                        // 衝突方向（車からオブジェクトへ）
                        const collisionDir = physObj.object.position.clone().sub(car.object.position).normalize();

                        // 速度を付与（車の速度 + 衝突方向の成分）
                        const impulseFactor = carSpeed * 0.8; // 衝突強度の係数
                        physObj.velocity.addScaledVector(collisionDir, impulseFactor);
                        
                        // 上方向の速度も付与（吹っ飛ぶ効果）
                        physObj.velocity.y += Math.abs(carSpeed) * 0.6;

                        // 回転速度も付与
                        const randomAxis = new THREE.Vector3(
                            Math.random() - 0.5,
                            Math.random() - 0.5,
                            Math.random() - 0.5
                        ).normalize();
                        physObj.angularVelocity.addScaledVector(randomAxis, carSpeed * 1.5);
                        
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

            // 地面との衝突判定（落下の停止）- 車と同じ方式に統一
            // 生成直後は判定をスキップ、ただし初期位置設定時は実行
            if (groundCollisionMeshes.length > 0 && (physObj.needsInitialPositioning || !physObj.isSpawning)) {
                // オブジェクトの中心座標を取得
                const objCenterX = physObj.object.position.x;
                const objCenterZ = physObj.object.position.z;
                const objCenterY = physObj.object.position.y;
                
                // バウンディングボックスをコライダーメッシュから計算（回転に影響されない）
                if (physObj.colliderMeshes && physObj.colliderMeshes.length > 0) {
                    physObj.boundingBox = getColliderBoundingBox(physObj.colliderMeshes);
                } else {
                    if (!physObj.boundingBox) {
                        physObj.boundingBox = new THREE.Box3();
                    }
                    physObj.boundingBox.setFromObject(physObj.object);
                }
                
                const bbMinY = physObj.boundingBox.min.y;
                
                // 上から下へレイキャスト
                // 初期配置時は指定されたY位置から、通常時はオブジェクト上方から
                const rayStartY = physObj.needsInitialPositioning ? objCenterY + 10 : objCenterY + 20;
                const rayOrigin = new THREE.Vector3(objCenterX, rayStartY, objCenterZ);
                const downDir = new THREE.Vector3(0, -1, 0);
                const raycaster = new THREE.Raycaster(rayOrigin, downDir, 0, 100.0);
                
                const intersects = raycaster.intersectObjects(groundCollisionMeshes, true);
                let groundY = null;
                
                if (intersects.length > 0) {
                    groundY = intersects[0].point.y;
                }
                
                // デバッグ：地面検出状況をログ出力（5秒に1回程度の頻度）
                if (!physObj.lastDebugTime) physObj.lastDebugTime = 0;
                physObj.lastDebugTime += delta;
                if (physObj.lastDebugTime > 5) {
                    console.log(`[DEBUG Physics] Initial: ${physObj.needsInitialPositioning} | ObjPos.Y: ${objCenterY.toFixed(2)} | BBminY: ${bbMinY.toFixed(2)} | RayStart: ${rayStartY.toFixed(2)} | Ground: ${groundY !== null ? groundY.toFixed(2) : 'null'} | Velocity.Y: ${physObj.velocity.y.toFixed(3)}`);
                    physObj.lastDebugTime = 0;
                }
                
                // 地面が検出された場合、オブジェクトを地面の上に配置
                if (groundY !== null) {
                    const minDistanceToGround = 0.05; // 地面からの最小距離（小さい値に変更）
                    
                    // シンプルな方式：オブジェクト中心をバウンディングボックスのオフセット分上げる
                    const bbHeight = physObj.boundingBox.max.y - physObj.boundingBox.min.y;
                    const bbMinOffset = objCenterY - physObj.boundingBox.min.y; // 中心から最下点までの距離
                    
                    // 目標：バウンディングボックスの最下点が地面より minDistanceToGround 上に来る
                    const targetCenterY = groundY + minDistanceToGround + bbMinOffset;
                    
                    // 初期位置設定時は一度で配置、それ以外は徐々に調整
                    const difference = targetCenterY - objCenterY;
                    if (physObj.needsInitialPositioning) {
                        // 初期位置設定時は一度で正確に配置
                        physObj.object.position.y = targetCenterY;
                        physObj.needsInitialPositioning = false;
                    } else if (Math.abs(difference) > 0.01) {
                        // 急激な変動を避けるため徐々に調整
                        const adjustAmount = Math.sign(difference) * Math.min(Math.abs(difference), Math.abs(physObj.velocity.y * delta) + 0.5);
                        physObj.object.position.y += adjustAmount;
                    } else {
                        // 差がほぼない場合は正確に配置
                        physObj.object.position.y = targetCenterY;
                    }
                    
                    // 地面に接触している場合の速度制御
                    const speed = physObj.velocity.length();
                    
                    // Y速度を制限（落下速度の上限を設定）
                    physObj.velocity.y = Math.max(physObj.velocity.y, -2.0);
                    
                    // 速度が小さい場合は完全に停止
                    if (speed < 0.1) {
                        physObj.velocity.set(0, 0, 0);
                        physObj.angularVelocity.multiplyScalar(0.85);
                    }
                    
                    physObj.isGrounded = true;
                    physObj.groundFrameCount = 3;
                } else {
                    // 地面が見つからない場合
                    physObj.isGrounded = false;
                    physObj.groundFrameCount = 0;
                    // ただし、Y速度の下限を設定して極端な落下を防止
                    physObj.velocity.y = Math.max(physObj.velocity.y, -2.0);
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
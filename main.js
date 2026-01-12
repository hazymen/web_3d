window.addEventListener("DOMContentLoaded", init);

function init() {
    const width = 1600;
    const height = 900;

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
    function loadCarColliderOBJ(objName, carIndex, position, scale = {x:1, y:1, z:1}) {
        const objLoader = new THREE.OBJLoader();
        objLoader.load(`models/${objName}`, function(object) {
            const colliderMeshes = [];
            object.traverse(function(child) {
                if (child.isMesh) {
                    // コライダーメッシュの表示用マテリアル（半透明の緑）
                    child.material = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.3, visible: true, wireframe: false });
                    // 衝突判定用に配列へ追加
                    collisionMeshes.push(child);
                    colliderMeshes.push(child); // 車固有のメッシュ配列にも追加
                    // boundingBoxを明示的に計算
                    if (!child.geometry.boundingBox) {
                        child.geometry.computeBoundingBox();
                    }
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
            object.position.set(position.x, position.y, position.z);
            object.scale.set(scale.x, scale.y, scale.z);
            scene.add(object);

            // 対応する車データを更新
            if (carIndex >= 0 && carIndex < cars.length) {
                cars[carIndex].colliderObject = object;
                cars[carIndex].colliderMeshes = colliderMeshes;
                cars[carIndex].colliderLoaded = true;
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
    loadGLBModel('71.glb', { x: 3, y: 2, z: 0 });

    // 複数の車を読み込む
    loadCarModel('gt86.glb', { x: -13, y: 0, z: -2});
    loadCarColliderOBJ('gt86_collider.obj', 0, { x: -13, y: 0, z: -2 });
    // 車を地形に配置（少し遅延させて地形メッシュが準備できるのを待つ）
    setTimeout(() => {
        if (cars.length > 0 && cars[0].object) {
            positionCarOnGround(cars[0].object, -13, -2);
        }
    }, 500);

    loadCarModel('s13.glb', { x: -23, y: 0, z: -2 });
    loadCarColliderOBJ('s13_collider.obj', 1, { x: -23, y: 0, z: -2 });
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

    const cityCollisionMeshes = []; // city_collider.obj専用の当たり判定用配列
    const groundCollisionMeshes = []; // city_ground.glb用地面判定配列（坂道対応）

    // city_collider.objを読み込み、当たり判定用にする関数
    function loadCityColliderOBJ(objName, position, scale = {x:1, y:1, z:1}) {
        const objLoader = new THREE.OBJLoader();
        objLoader.load(`models/${objName}`, function(object) {
            object.traverse(function(child) {
                if (child.isMesh) {
                    // 透明マテリアル（当たり判定用・非表示）
                    child.material = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.1, visible: false });
                    // 衝突判定用に配列へ追加
                    cityCollisionMeshes.push(child);
                    // boundingBoxを明示的に計算
                    if (!child.geometry.boundingBox) {
                        child.geometry.computeBoundingBox();
                    }
                    // ワイヤーフレームを追加して緑色の線で描画
                    const wireframe = new THREE.LineSegments(
                        new THREE.WireframeGeometry(child.geometry),
                        new THREE.LineBasicMaterial({ color: 0x00ff00 })
                    );
                    wireframe.position.copy(child.position);
                    wireframe.rotation.copy(child.rotation);
                    wireframe.scale.copy(child.scale);
                    child.add(wireframe);
                    child.visible = true; // ワイヤーフレームだけ見せる
                }
            });
            object.position.set(position.x, position.y, position.z);
            object.scale.set(scale.x, scale.y, scale.z);
            scene.add(object);
        });
    }

    // city.glb自体は見た目用として配置（同時に当たり判定用メッシュも収集）
    function loadCityModel(modelName, position) {
        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.load(`models/${modelName}`, function(gltf) {
            gltf.scene.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.frustumCulled = true;
                    // 町のモデルのメッシュを当たり判定用に追加
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
    loadCityColliderOBJ('city_collider.obj', { x: 0, y: 0.01, z: 0 });

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
    
    const speedDiv = document.createElement('div');
    speedDiv.style.position = 'absolute';
    speedDiv.style.right = '10px';
    speedDiv.style.bottom = '10px';
    speedDiv.style.color = '#fff';
    speedDiv.style.background = 'rgba(0,0,0,0.5)';
    speedDiv.style.padding = '4px 12px';
    speedDiv.style.fontFamily = 'monospace';
    speedDiv.style.fontSize = '18px';
    speedDiv.style.zIndex = '100';
    speedDiv.innerText = '';
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
            // パラメータ
            const carMass = 1250; // kg
            const carPower = 200 * 0.7355 * 1000; // 200ps→kW→W
            const carGripFront = 1.2;
            const carGripRear = 1.0;
            const carWheelBase = 2.6; // m
            const carTireRadius = 0.32; // m
            const carInertia = 2500;

            // 状態変数（車ごとに異なる状態を保持）
            if (!car.state) {
                car.state = {
                    vx: 0, vy: 0, yaw: carObject.rotation.y, yawRate: 0,
                    throttle: 0, brake: 0, steer: 0, slipAngle: 0
                };
            }
            const state = car.state;

            // 入力
            state.throttle = carForward ? 1 : 0;
            state.brake = 0; // ブレーキは常に0に
            if (carBackward) state.throttle = -0.2; // バック時は低速で
            let steerInput = 0;
            if (carLeft && !carRight) steerInput = 1;
            else if (carRight && !carLeft) steerInput = -1;
            state.steer += (steerInput - state.steer) * 0.2;

            // ステア最大角（速度依存で減少）
            const speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
            const steerMax = (speed < 10) ? 0.6 : 0.25 + 0.35 * Math.max(0, 1 - (speed - 10) / 50);
            let steerAngle = state.steer * steerMax;
            // バック時はステア操作を逆にする
            if (state.vx < 0) {
                steerAngle = -steerAngle;
            }

            // 駆動力（FR：後輪のみ駆動）
            const maxForce = carPower / Math.max(speed, 0.5); // バック時の速度計算を改善
            let driveForce = state.throttle * maxForce;
            driveForce = Math.max(Math.min(driveForce, 6000), -3000); // バック時は-3000まで制限

            // ブレーキ力
            let brakeForce = state.brake * 8000;

            // タイヤ横力（バック時も正しく計算するため Math.max の代わりに Math.abs を使用）
            const slipAngleFront = Math.atan2(state.vy + carWheelBase * state.yawRate / 2, Math.max(Math.abs(state.vx), 0.1)) - steerAngle;
            const slipAngleRear = Math.atan2(state.vy - carWheelBase * state.yawRate / 2, Math.max(Math.abs(state.vx), 0.1));
            const tireForceFront = -carGripFront * slipAngleFront * 8000;
            const tireForceRear = -carGripRear * slipAngleRear * 8000;

            // 前後タイヤ合成
            const forceX = driveForce - brakeForce + tireForceRear * Math.sin(steerAngle) + tireForceFront * Math.sin(steerAngle);
            const forceY = tireForceFront * Math.cos(steerAngle) + tireForceRear * Math.cos(0);

            // 車体速度・ヨー角速度の更新
            state.vx += (forceX / carMass) * delta;
            state.vy += (forceY / carMass) * delta;
            state.vx *= 0.995;
            state.vy *= 0.995;

            state.yawRate += ((carWheelBase / 2) * (tireForceFront - tireForceRear) / carInertia) * delta;
            state.yawRate *= 0.98;
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

            // サスペンション・ロール（各車両ごとに状態を保持）
            if (!car.userData.suspensionRoll) car.userData.suspensionRoll = 0;
            const rollCoef = 0.12;
            const maxRoll = Math.PI / 10;
            const rollTarget = THREE.MathUtils.clamp(-state.yawRate * rollCoef, -maxRoll, maxRoll);
            car.userData.suspensionRoll += (rollTarget - car.userData.suspensionRoll) * 0.1;
            carObject.rotation.x = 0;
            carObject.rotation.z = car.userData.suspensionRoll;

            // 前輪ステア
            if (!car.userData.wheelFR || !car.userData.wheelFL) {
                carObject.traverse(obj => {
                    if (obj.name === "wheel_FR") car.userData.wheelFR = obj;
                    if (obj.name === "wheel_FL") car.userData.wheelFL = obj;
                });
            }
            if (car.userData.wheelFR) {
                car.userData.wheelFR.rotation.y = steerAngle;
            }
            if (car.userData.wheelFL) {
                car.userData.wheelFL.rotation.y = steerAngle;
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
            const carRaycaster = new THREE.Raycaster(
                carFrontPos,
                carDir,
                0,
                Math.max(2.0, Math.abs(state.vx) * 2)
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
            if (carIntersects.length > 0 && carIntersects[0].distance < 0.8 && state.vx > 0.1) {
                state.vx = 0;
                state.vy = 0;
                state.yawRate = 0; // ヨー角速度もリセット
                // 衝突時に車を少し押し戻す
                carObject.position.add(worldForward.clone().multiplyScalar(-0.1));
            }
            
            // 地面対応（シンプルな方法：車の中心直下の地面を検出）
            if (foundGround && groundCollisionMeshes.length > 0) {
                // 車の中心から直下にレイキャストして最も近い地面を検出
                const rayOrigin = carObject.position.clone().add(new THREE.Vector3(0, 5.0, 0));
                const downDir = new THREE.Vector3(0, -1, 0);
                const carHeightRaycaster = new THREE.Raycaster(rayOrigin, downDir, 0, 15.0);
                const carHeightIntersects = carHeightRaycaster.intersectObjects(groundCollisionMeshes, true);
                
                if (carHeightIntersects.length > 0) {
                    // 最も近い地面が見つかった
                    const groundY = carHeightIntersects[0].point.y;
                    const targetHeight = groundY + 0.5; // 車の底から0.5上
                    
                    // 高さを即座に設定（フレームごとに確実に地面に配置）
                    carObject.position.y = targetHeight;
                    
                    // デバッグ情報（最初は出力、後は削除）
                    // console.log(`Car at height: ${targetHeight.toFixed(2)}, ground: ${groundY.toFixed(2)}`);
                } else {
                    // console.log(`[DEBUG] No ground intersection found in car physics loop`);
                }
            } else if (!foundGround) {
                // console.log(`[DEBUG] foundGround=false, no ground height adjustment`);
            }
            
            // 衝突判定（後方）
            const carBackCheckPos = carObject.position.clone().add(worldForward.clone().multiplyScalar(-1.0)); // 後面から発射
            const carBackDir = worldForward.clone().multiplyScalar(-1).normalize();
            const carBackRaycaster = new THREE.Raycaster(
                carBackCheckPos,
                carBackDir,
                0,
                Math.max(2.0, Math.abs(state.vx) * 2)
            );
            const carBackIntersects = carBackRaycaster.intersectObjects(cityCollisionMeshes, true);
            if (carBackIntersects.length > 0 && carBackIntersects[0].distance < 0.8 && state.vx < -0.1) {
                state.vx = 0;
                state.vy = 0;
                state.yawRate = 0; // ヨー角速度もリセット
                // 衝突時に車を少し押し戻す
                carObject.position.add(worldForward.clone().multiplyScalar(0.1));
            }

            const speedKmh = speed * 3.6;
            speedDiv.innerText = `Speed: ${Math.round(speedKmh)} km/h`;
            
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

            // 乗車中の車のコライダーを即座に同期（走行中の追従性を重視）
            if (car.colliderObject) {
                car.colliderObject.position.copy(carObject.position);
                car.colliderObject.quaternion.copy(carObject.quaternion);
            }

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
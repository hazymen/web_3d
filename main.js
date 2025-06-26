window.addEventListener("DOMContentLoaded", init);

function init() {
    const width = 960;
    const height = 540;

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
    camera.position.set(0, 1.6, 5); // 一人称視点の高さ

    function setFov(fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
    }
    setFov(60);

    let moveForward = false;
    let moveBackward = false;
    let rotateLeft = false;
    let rotateRight = false;

    const velocity = 0.1;
    const rotationSpeed = 0.03;

    const clock = new THREE.Clock();
    
    
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
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    
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
    meshFloor.receiveShadow = true;
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

    // 操作モード切替用フラグ
    let isCarMode = false;

    // gt86.glb専用の読み込み・配置・操作用変数
    let carObject = null;
    let carMixer = null;
    let carVelocity = 0;
    let carSteer = 0;
    const carMaxSpeed = 1;
    const carAccel = 0.0025;
    const carFriction = 0.98;
    const carSteerSpeed = 0.06;
    // 車の最大ハンドル切れ度を調整する変数
    let carMaxSteer = 0.062;

    let canEnterCar = false;
    const enterCarDistance = 3.0;
    // 車視点切り替え用フラグ
    let carViewMode = 1; // 1:三人称(デフォルト), 2:車内視点


    // カメラ追従用のスムーズな追従位置（初期値は車の位置）
    let cameraFollowPos = new THREE.Vector3(0, 3, -6);

    let carStopped = false;
    let carStopTime = 0;


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
            console.log('collisionMeshes after loading car:', collisionMeshes);

            gltf.scene.position.set(position.x, position.y, position.z);
            gltf.scene.scale.set(1, 1, 1);
            scene.add(gltf.scene);
            carObject = gltf.scene;

            // アニメーションがあれば再生
            if (gltf.animations && gltf.animations.length > 0) {
                carMixer = new THREE.AnimationMixer(gltf.scene);
                gltf.animations.forEach((clip) => {
                    carMixer.clipAction(clip).play();
                });
            }
        });
    }

    let carColliderObject = null; // 車コライダーOBJの参照を保持

    // 車の当たり判定用OBJモデルを読み込み、透明＋ワイヤーフレーム表示する関数
    function loadCarColliderOBJ(objName, position, scale = {x:1, y:1, z:1}) {
        const objLoader = new THREE.OBJLoader();
        objLoader.load(`models/${objName}`, function(object) {
            object.traverse(function(child) {
                if (child.isMesh) {
                    // 透明マテリアル（当たり判定用・非表示）
                    child.material = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.1, visible: false });
                    // 衝突判定用に配列へ追加
                    collisionMeshes.push(child);
                    // boundingBoxを明示的に計算
                    if (!child.geometry.boundingBox) {
                        child.geometry.computeBoundingBox();
                    }
                    // ワイヤーフレームを追加
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
            carColliderObject = object; // コライダーOBJの参照を保存
        });
    }

    // loadOBJModel('ak47.obj', { x: 0, y: 1, z: 0 });
    loadGLBModel('71.glb', { x: 3, y: 2, z: 0 });

    loadCarModel('gt86.glb', { x: 4, y: 0, z: -4 });
    loadCarColliderOBJ('gt86_collider.obj', { x: 4, y: 0, z: -4 });


    const cityCollisionMeshes = []; // city2.glb専用の当たり判定用配列

    // city.glb専用の読み込み・配置関数
    function loadCityModel(modelName, position) {
        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.load(`models/${modelName}`, function(gltf) {
            gltf.scene.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    // city2.glbの当たり判定用
                    cityCollisionMeshes.push(child);
                    child.frustumCulled = true;
                }
            });
            gltf.scene.position.set(position.x, position.y, position.z);
            gltf.scene.scale.set(1, 1, 1);
            scene.add(gltf.scene);
        });
    }

    loadCityModel('city2.glb', { x: 0, y: 0.01, z: 0 });

    // 操作切り替え例（F1キーで切り替え）
    document.addEventListener('keydown', (event) => {
        if (event.code === 'KeyF') {
            if (!isCarMode && carObject) {
                // 歩行者モード時、車の近くなら乗る
                const playerPos = controls.getObject().position;
                const carPos = carObject.position;
                const dist = playerPos.distanceTo(carPos);
                if (dist < enterCarDistance) {
                    isCarMode = true;
                }
            } else if (isCarMode) {
                // 車モード時、降りる
                isCarMode = false;
                // 車の横に降ろす
                if (carObject) {
                    const carPos = carObject.position.clone();
                    // 車の右側に降ろす（Yは地面高さ）
                    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(carObject.quaternion).normalize();
                    const exitPos = carPos.clone().add(right.multiplyScalar(2));
                    controls.getObject().position.set(exitPos.x, groundHeight, exitPos.z);
                }
            }
        }

        // 車モード時のみ視点切り替え
        if (isCarMode && carObject) {
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
                case 'Space':
                    if (!isJumping && Math.abs(controls.getObject().position.y - groundHeight) < 0.05) {
                        isJumping = true;
                        velocityY = 0;
                        jumpFrame = 0;
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
            }
        }
        if (isCarMode) {
            switch (event.code) {
                case 'KeyW': carForward = false; break;
                case 'KeyS': carBackward = false; break;
                case 'KeyA': carLeft = false; break;
                case 'KeyD': carRight = false; break;
            }
        }
    });

    const controls = new THREE.PointerLockControls(camera, renderer.domElement);

    // 移動速度を調整する変数
    let moveSpeed = 0.04;

    // マウス感度（回転速度）を調整する変数
    let mouseSensitivity = 0.5; // 小さいほどゆっくり、大きいほど速い

    controls.pointerSpeed = mouseSensitivity;

    canvasElement.addEventListener('click', () => {
        controls.lock();
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

        frames++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
            fps = frames;
            frames = 0;
            lastTime = now;
            fpsDiv.innerText = `FPS: ${fps}`;
        }
        const info = renderer.info;
        polyDiv.innerText = `Polygons: ${info.render.triangles}`;

        let camPos;
        if (!isCarMode) {
            camPos = controls.getObject().position;
        } else if (carViewMode === 1 || carViewMode === 2) {
            camPos = camera.position;
        }
        if (camPos) {
            posDiv.innerText = `Pos: (${camPos.x.toFixed(2)}, ${camPos.y.toFixed(2)}, ${camPos.z.toFixed(2)})`;
        }

        const delta = clock.getDelta();
        mixers.forEach(mixer => mixer.update(delta));
        if (carMixer) carMixer.update(delta);

        canEnterCar = false;
        if (!isCarMode && carObject) {
            const playerPos = controls.getObject().position;
            const carPos = carObject.position;
            if (playerPos.distanceTo(carPos) < enterCarDistance) {
                canEnterCar = true;
                // ここで「Fで乗車」などのUI表示も可能
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
            if (isJumping) {
                if (jumpFrame < jumpDuration) {
                    velocityY += jumpAccel;
                    jumpFrame++;
                }
                velocityY += gravity;
                obj.position.y += velocityY;
                if (obj.position.y <= groundHeight) {
                    obj.position.y = groundHeight;
                    isJumping = false;
                    velocityY = 0;
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
            if (moveVec.length() > 0) {
                moveVec.normalize();
                moveVec.applyQuaternion(camera.quaternion);
                moveVec.y = 0;
                moveVec.normalize();
                const nextPos = currentPos.clone().add(moveVec.clone().multiplyScalar(moveSpeed));
                if (canMove(nextPos)) {
                    controls.getObject().position.copy(nextPos);
                }
            }
            renderer.render(scene, camera);
        }
        if (isCarMode && carObject) {
            // 車モード
            // 停止状態の判定
            if (Math.abs(carVelocity) < 0.001) {
                if (!carStopped) {
                    carStopped = true;
                    carStopTime = performance.now();
                }
            } else {
                carStopped = false;
            }

            // ブレーキ・加速・バック処理
            if (carForward) {
                if (carVelocity < -0.01) {
                    // バック中にW→ブレーキ
                    carVelocity += carAccel * 2;
                    if (carVelocity > 0) carVelocity = 0;
                } else if (carStopped && performance.now() - carStopTime < 200) {
                    // 停止直後は加速しない（200ms待つ）
                    // 何もしない
                } else {
                    // 前進
                    carVelocity += carAccel;
                }
            }
            if (carBackward) {
                if (carVelocity > 0.01) {
                    // 前進中にS→ブレーキ
                    carVelocity -= carAccel * 2;
                    if (carVelocity < 0) carVelocity = 0;
                } else if (carStopped && performance.now() - carStopTime < 200) {
                    // 停止直後はバック加速しない（200ms待つ）
                    // 何もしない
                } else {
                    // 停止またはバック
                    carVelocity -= carAccel * 0.5
                }
            }
            // 速度制限
            carVelocity = Math.max(-carMaxSpeed, Math.min(carMaxSpeed, carVelocity));
            // 摩擦
            carVelocity *= carFriction;

            // ステアリングの最大値を速度に応じて変化させる
            // 例: 20km/h未満で最大値、60km/h以上で最小値、その間は線形補間
            const minSteer = 0.03; // 高速時の最小ハンドル切れ度
            const maxSteer = 0.8; // 低速時の最大ハンドル切れ度
            const speedKmhForSteer = Math.abs(carVelocity) / delta * 3.6;

            let dynamicSteer = maxSteer;
            if (speedKmhForSteer > 8) {
                if (speedKmhForSteer >= 40) {
                    dynamicSteer = minSteer;
                } else {
                    // 20～60km/hの間は線形に変化
                    dynamicSteer = maxSteer - (maxSteer - minSteer) * ((speedKmhForSteer - 20) / 40);
                }
            }

            // ハンドル
            if (carLeft && !carRight) carSteer = carSteerSpeed;
            else if (carRight && !carLeft) carSteer = -carSteerSpeed;
            else carSteer = 0;

            // 最大ハンドル切れ度を速度依存で適用
            carSteer = Math.max(-dynamicSteer, Math.min(dynamicSteer, carSteer));

            // 回転
            carObject.rotation.y += carSteer * carVelocity;

            // 衝突判定：車の進行方向にレイを飛ばしてcity2.glbと衝突したら速度0
            const carFront = carObject.position.clone();
            const carDir = new THREE.Vector3(0, 0, -1).applyQuaternion(carObject.quaternion).normalize();
            const carRaycaster = new THREE.Raycaster(
                carFront,
                carDir,
                0,
                Math.max(1.5, Math.abs(carVelocity) * 2)
            );
            const carIntersects = carRaycaster.intersectObjects(cityCollisionMeshes, true);
            if (carIntersects.length > 0) {
                // 前進中のみ速度0にする（バックは止めない）
                if (carVelocity > 0) carVelocity = 0;
            }

            // 前進・後退
            const forward = carDir.clone();
            carObject.position.add(forward.multiplyScalar(carVelocity));

            // カメラ追従
            const carPos = carObject.position.clone();
            const cameraDir = carDir.clone();
            cameraDir.y = 0;
            cameraDir.normalize();

            if (carViewMode === 1) {
                // 三人称（後方上空）スムーズ追従
                const targetOffset = cameraDir.clone().multiplyScalar(-6).add(new THREE.Vector3(0, 3, 0));
                const targetPos = carPos.clone().add(targetOffset);

                cameraFollowPos.x += (targetPos.x - cameraFollowPos.x) * 0.04;
                cameraFollowPos.z += (targetPos.z - cameraFollowPos.z) * 0.04;
                cameraFollowPos.y += (targetPos.y - cameraFollowPos.y) * 0.18;

                camera.position.copy(cameraFollowPos);
                camera.lookAt(carPos);
            } else if (carViewMode === 2) {
                // 車内視点（即追従でOK）
                const cameraOffset = cameraDir.clone().multiplyScalar(0).add(new THREE.Vector3(0.45, 1.35, 0));
                camera.position.copy(carPos.clone().add(cameraOffset));
                camera.lookAt(carPos.clone().add(cameraDir.clone().multiplyScalar(10)));
            }

            // 速度[m/s] → [km/h]（1単位=1m、1秒間の移動量×3.6）
            // carVelocityは1フレームあたりの移動量なので、deltaで積算して平均速度を算出
            // 直近数フレームの速度を平均化して表示を安定させる

            // 速度履歴バッファ
            if (!window.speedHistory) window.speedHistory = [];
            const currentSpeed = Math.abs(carVelocity) / delta; // m/s
            window.speedHistory.push(currentSpeed);
            if (window.speedHistory.length > 10) window.speedHistory.shift(); // 直近10フレーム分

            // 平均速度を計算
            const avgSpeed = window.speedHistory.reduce((a, b) => a + b, 0) / window.speedHistory.length;
            const speedKmh = avgSpeed * 3.6;

            speedDiv.innerText = `Speed: ${Math.round(speedKmh)} km/h`;

            renderer.render(scene, camera);
        }

        if (isCarMode && carObject && carColliderObject) {
            // 車コライダーOBJを車本体と同じ位置・回転に追従させる
            carColliderObject.position.copy(carObject.position);
            carColliderObject.quaternion.copy(carObject.quaternion);
        }
    }
    let lastTime = performance.now();
    let frames = 0;
    let fps = 0;
    animate();
}
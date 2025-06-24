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
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 5); // 一人称視点の高さ

    let moveForward = false;
    let moveBackward = false;
    let rotateLeft = false;
    let rotateRight = false;

    const velocity = 0.1;
    const rotationSpeed = 0.03;

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
    sunLight.position.set(100, 100, 100); // 太陽の位置（高い位置に設定）
    sunLight.castShadow = true; // 影を有効化
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    
    // 影の範囲を広げる（ここを追加・調整）
    sunLight.shadow.camera.left = -50;
    sunLight.shadow.camera.right = 50;
    sunLight.shadow.camera.top = 50;
    sunLight.shadow.camera.bottom = -50;
    sunLight.shadow.camera.near = 1; //影の最短描画範囲
    sunLight.shadow.camera.far = 200; //影の最長描画範囲

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


    const skyGeometry = new THREE.SphereGeometry(100, 8, 8);
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
        });
    }

    loadOBJModel('ak47.obj', { x: 0, y: 1, z: 0 });
    
    loadGLBModel('71.glb', { x: 2, y: 1, z: 0 });


    document.addEventListener('keydown', (event) => {
        switch (event.code) {
            case 'KeyW':
                moveForward = true;
                break;
            case 'KeyS':
                moveBackward = true;
                break;
            case 'KeyA':
                rotateLeft = true;
                break;
            case 'KeyD':
                rotateRight = true;
                break;
            case 'Space':
                if (!isJumping && Math.abs(controls.getObject().position.y - groundHeight) < 0.05) {
                    isJumping = true;
                    velocityY = 0;
                    jumpFrame = 0;
                }
                break;
        }
    });

    document.addEventListener('keyup', (event) => {
        switch (event.code) {
            case 'KeyW':
                moveForward = false;
                break;
            case 'KeyS':
                moveBackward = false;
                break;
            case 'KeyA':
                rotateLeft = false;
                break;
            case 'KeyD':
                rotateRight = false;
                break;
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

        let obj = controls.getObject();
        if (isJumping) {
            // ジャンプ開始から一定フレームだけ上向き加速度を加える
            if (jumpFrame < jumpDuration) {
                velocityY += jumpAccel;
                jumpFrame++;
            }
            velocityY += gravity; // 毎フレーム重力加速度を加える
            obj.position.y += velocityY;

            // 地面に着地したら止める
            if (obj.position.y <= groundHeight) {
                obj.position.y = groundHeight;
                isJumping = false;
                velocityY = 0;
            }
        }
        // 回転
        // if (rotateLeft) camera.rotation.y += rotationSpeed;
        // if (rotateRight) camera.rotation.y -= rotationSpeed;

        // 前進・後退・左右移動
        const direction = new THREE.Vector3();
        controls.getDirection(direction);
        direction.y = 0; // 水平移動のみ
        direction.normalize();

        const right = new THREE.Vector3();
        right.crossVectors(direction, camera.up).normalize();

        // カメラの現在位置
        const currentPos = controls.getObject().position.clone();

        // 前進・後退・左右移動のベクトル計算
        let moveVec = new THREE.Vector3();
        if (moveForward) moveVec.z -= 1;
        if (moveBackward) moveVec.z += 1;
        if (rotateRight) moveVec.x += 1;
        if (rotateLeft) moveVec.x -= 1;
        if (moveVec.length() > 0) {
            moveVec.normalize();
            // カメラの向きに合わせて移動ベクトルを回転
            moveVec.applyQuaternion(camera.quaternion);
            moveVec.y = 0; // 水平移動のみ
            moveVec.normalize();

            // 移動先を計算
            const nextPos = currentPos.clone().add(moveVec.clone().multiplyScalar(moveSpeed));
            // 衝突判定
            if (canMove(nextPos)) {
                controls.getObject().position.copy(nextPos);
            }
        }
        renderer.render(scene, camera);
    }
    let lastTime = performance.now();
    let frames = 0;
    let fps = 0;
    animate();
    //tick();

    function tick() {
        renderer.render(scene, camera); // レンダリング
        requestAnimationFrame(tick);
    }
}
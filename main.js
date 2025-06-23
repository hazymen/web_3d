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


    // 3Dモデルの読み込み（GLB/GLTF）
    const gltfLoader = new THREE.GLTFLoader();
    function loadGLBModel(modelName, position) {
        const gltfLoader = new THREE.GLTFLoader();
        gltfLoader.load(`models/${modelName}`, function(gltf) {
            gltf.scene.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
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

        if (moveForward) controls.moveForward(moveSpeed);
        if (moveBackward) controls.moveForward(-moveSpeed);
        if (rotateRight) controls.moveRight(moveSpeed);
        if (rotateLeft) controls.moveRight(-moveSpeed);

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
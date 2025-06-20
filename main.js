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
    scene.add(sunLight);
    // 光源を作成
    const light = new THREE.SpotLight(0xffffff, 400, 100, Math.PI / 4, 1);
    light.intensity = 0.0;
    light.position.set(10, 10, 10);
    light.castShadow = true;
    scene.add(light);

    const meshFloor = new THREE.Mesh(
        new THREE.BoxGeometry(100, 0.1, 100),
        new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.0 }),
    );
    // 影を受け付ける
    meshFloor.position.set(0, 0, 0);
    meshFloor.receiveShadow = true;
    scene.add(meshFloor);


    const skyGeometry = new THREE.SphereGeometry(100, 32, 32);
    const skyMaterial = new THREE.MeshBasicMaterial({
        color: 0x87ceeb, // 空色
        side: THREE.BackSide // 内側を表示
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(sky);


    // 3Dモデルの読み込み
    const objLoader = new THREE.OBJLoader();
    objLoader.load('models/ak47.obj', function(object) {
    // モデル内のすべてのMeshに対して影の設定を行う
        object.traverse(function(child) {
            if (child.isMesh) {
                child.castShadow = true;      // 影を落とす
                child.receiveShadow = true;   // 影を受ける（必要に応じて）
            }
        });
        object.position.set(0, 1, 0);
        scene.add(object);
    });

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

    function animate() {
        requestAnimationFrame(animate);

        // 回転
        if (rotateLeft) camera.rotation.y += rotationSpeed;
        if (rotateRight) camera.rotation.y -= rotationSpeed;

        // 前進・後退
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);
        direction.y = 0; // 水平移動のみ

        if (moveForward) camera.position.add(direction.multiplyScalar(velocity));
        if (moveBackward) camera.position.add(direction.multiplyScalar(-velocity));

        renderer.render(scene, camera);
    }

    animate();
    tick();

    function tick() {
        renderer.render(scene, camera); // レンダリング
        requestAnimationFrame(tick);
    }
}
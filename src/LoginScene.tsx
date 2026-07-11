import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function LoginScene() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.15, 6.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const world = new THREE.Group();
    scene.add(world);

    const shellGeometry = new THREE.IcosahedronGeometry(1.32, 2);
    const shell = new THREE.Mesh(shellGeometry, new THREE.MeshPhysicalMaterial({
      color: 0x6f1f34,
      emissive: 0x24050d,
      metalness: 0.72,
      roughness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.16
    }));
    world.add(shell);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(shellGeometry, 18),
      new THREE.LineBasicMaterial({ color: 0xff6a7d, transparent: true, opacity: 0.58 })
    );
    edges.scale.setScalar(1.012);
    world.add(edges);

    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.55, 1),
      new THREE.MeshStandardMaterial({ color: 0xe9edf4, emissive: 0x41202c, emissiveIntensity: 0.5, metalness: 0.45, roughness: 0.22 })
    );
    world.add(core);

    const ringMaterial = new THREE.MeshStandardMaterial({ color: 0xaeb7c7, metalness: 0.82, roughness: 0.28 });
    const ringOne = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.018, 8, 180), ringMaterial);
    ringOne.rotation.set(1.04, 0.12, -0.42);
    world.add(ringOne);
    const ringTwo = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.012, 8, 160), new THREE.MeshStandardMaterial({ color: 0xff5269, emissive: 0x3a0711, metalness: 0.65, roughness: 0.3 }));
    ringTwo.rotation.set(0.28, 1.12, 0.35);
    world.add(ringTwo);

    const nodeGeometry = new THREE.SphereGeometry(0.055, 10, 10);
    const nodes = new THREE.InstancedMesh(nodeGeometry, new THREE.MeshStandardMaterial({ color: 0xf6f7fa, emissive: 0x641b2a, emissiveIntensity: 0.35 }), 32);
    const matrix = new THREE.Matrix4();
    const positions: THREE.Vector3[] = [];
    for (let index = 0; index < 32; index += 1) {
      const y = 1 - (index / 31) * 2;
      const radius = Math.sqrt(1 - y * y);
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const position = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius).multiplyScalar(1.62);
      positions.push(position);
      matrix.makeTranslation(position.x, position.y, position.z);
      nodes.setMatrixAt(index, matrix);
    }
    world.add(nodes);

    const connections: number[] = [];
    for (let index = 0; index < positions.length; index += 2) {
      const start = positions[index];
      const end = positions[(index + 7) % positions.length];
      connections.push(start.x, start.y, start.z, end.x, end.y, end.z);
    }
    const connectionGeometry = new THREE.BufferGeometry();
    connectionGeometry.setAttribute("position", new THREE.Float32BufferAttribute(connections, 3));
    world.add(new THREE.LineSegments(connectionGeometry, new THREE.LineBasicMaterial({ color: 0x8b95a7, transparent: true, opacity: 0.22 })));

    scene.add(new THREE.HemisphereLight(0xe8edf7, 0x17050a, 1.7));
    const keyLight = new THREE.PointLight(0xff5269, 24, 16, 2);
    keyLight.position.set(3.2, 2.4, 3.5);
    scene.add(keyLight);
    const fillLight = new THREE.PointLight(0x4dd9bc, 12, 14, 2);
    fillLight.position.set(-3.4, -1.8, 2.2);
    scene.add(fillLight);

    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    let reducedMotion = false;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = (event: MediaQueryListEvent | MediaQueryList) => { reducedMotion = event.matches; };
    syncMotion(motionQuery);
    motionQuery.addEventListener("change", syncMotion);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    const onPointerMove = (event: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 0.34;
      pointerY = ((event.clientY - rect.top) / rect.height - 0.5) * 0.22;
    };
    mount.addEventListener("pointermove", onPointerMove, { passive: true });

    const clock = new THREE.Clock();
    const animate = () => {
      const elapsed = clock.getElapsedTime();
      if (!reducedMotion) {
        world.rotation.y += (pointerX + elapsed * 0.12 - world.rotation.y) * 0.025;
        world.rotation.x += (-pointerY + Math.sin(elapsed * 0.55) * 0.08 - world.rotation.x) * 0.035;
        ringOne.rotation.z = elapsed * 0.16;
        ringTwo.rotation.z = -elapsed * 0.12;
        core.rotation.x = elapsed * 0.24;
        core.rotation.y = elapsed * 0.32;
      }
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      motionQuery.removeEventListener("change", syncMotion);
      mount.removeEventListener("pointermove", onPointerMove);
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach(item => item.dispose());
          else material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="login-scene" ref={mountRef} />;
}

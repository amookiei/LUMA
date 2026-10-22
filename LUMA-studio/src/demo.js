import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// A real, editable product model. Every part is geometry, including the stitching.
export function createDemoHeadphones() {
  const product = new THREE.Group();
  product.name = 'FORM / H-01';
  const shell = new THREE.MeshPhysicalMaterial({ color: 0x34373b, metalness: .66, roughness: .29, clearcoat: .24, clearcoatRoughness: .34 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0x8c9095, metalness: .96, roughness: .28 });
  const darkAlloy = new THREE.MeshStandardMaterial({ color: 0x24272b, metalness: .82, roughness: .34 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x121416, roughness: .84, metalness: .02 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x202226, roughness: .72, metalness: .03 });
  const stitch = new THREE.MeshStandardMaterial({ color: 0x54575b, roughness: .94 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xd7edff, emissive: 0x9bcaff, emissiveIntensity: 2 });

  function add(geometry, material, position, parent = product) {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  // The elliptical, ribbon-like band has a subtle bevel on every edge.
  function band(radiusX, radiusY, width, depth, yOffset, material) {
    const shape = new THREE.Shape();
    const steps = 100;
    for (let i = 0; i <= steps; i++) {
      const a = .05 + i / steps * (Math.PI - .1);
      const x = Math.cos(a) * radiusX;
      const y = Math.sin(a) * radiusY + yOffset;
      i ? shape.lineTo(x, y) : shape.moveTo(x, y);
    }
    for (let i = steps; i >= 0; i--) {
      const a = .05 + i / steps * (Math.PI - .1);
      shape.lineTo(Math.cos(a) * (radiusX - width), Math.sin(a) * (radiusY - width) + yOffset);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 4, steps: 1, bevelSize: .034, bevelThickness: .034, curveSegments: 48 });
    geo.translate(0, 0, -depth / 2);
    return add(geo, material);
  }
  band(1.14, 1.32, .115, .40, 1.65, darkAlloy);
  band(1.105, 1.29, .125, .425, 1.66, leather);
  band(1.13, 1.325, .023, .024, 1.65, alloy).position.z = .23;
  band(1.13, 1.325, .023, .024, 1.65, alloy).position.z = -.23;

  const stitchGeometry = new THREE.SphereGeometry(.009, 5, 4);
  for (const z of [-.19, .19]) {
    for (let i = 0; i < 65; i++) {
      const a = .22 + i / 64 * (Math.PI - .44);
      add(stitchGeometry, stitch, [Math.cos(a) * 1.083, Math.sin(a) * 1.267 + 1.65, z]);
    }
  }

  for (const side of [-1, 1]) {
    const cup = new THREE.Group();
    cup.position.set(side * 1.05, .98, 0);
    cup.rotation.z = side * -.12;
    cup.rotation.y = side * -.07;
    product.add(cup);
    const housing = add(new THREE.CylinderGeometry(.64, .64, .31, 80, 1), shell, [0, 0, 0], cup);
    housing.rotation.z = Math.PI / 2;
    housing.scale.set(1.25, 1, 1);
    for (const offset of [-.17, .17]) {
      const rim = add(new THREE.TorusGeometry(.625, .018, 8, 96), alloy, [offset, 0, 0], cup);
      rim.rotation.y = Math.PI / 2;
      rim.scale.y = 1.25;
    }
    const exterior = add(new THREE.SphereGeometry(.625, 64, 40), shell, [side * .15, 0, 0], cup);
    exterior.scale.set(.22, 1.25, 1);
    const exteriorInset = add(new THREE.CircleGeometry(.515, 72), darkAlloy, [side * .286, 0, 0], cup);
    exteriorInset.rotation.y = side * Math.PI / 2;
    exteriorInset.scale.y = 1.25;
    const insetRing = add(new THREE.TorusGeometry(.515, .008, 5, 72), alloy, [side * .288, 0, 0], cup);
    insetRing.rotation.y = Math.PI / 2;
    insetRing.scale.y = 1.25;

    const pad = add(new THREE.TorusGeometry(.475, .135, 20, 80), leather, [-side * .25, 0, 0], cup);
    pad.rotation.y = Math.PI / 2;
    pad.scale.y = 1.32;
    const inner = add(new THREE.CircleGeometry(.42, 64), rubber, [-side * .255, 0, 0], cup);
    inner.rotation.y = -side * Math.PI / 2;
    inner.scale.y = 1.3;

    // Fine radial creases give the ear cushions a physical textile finish.
    for (let i = 0; i < 66; i++) {
      const a = i / 66 * Math.PI * 2;
      const mark = add(new THREE.SphereGeometry(.011, 4, 3), rubber,
        [-side * .356, Math.sin(a) * .49 * 1.32, Math.cos(a) * .49], cup);
      mark.scale.set(.48, 1.9, 1.1);
      mark.rotation.x = -a;
    }

    const arm = add(new RoundedBoxGeometry(.13, .67, .15, 4, .035), alloy, [side * .06, .71, 0], cup);
    arm.rotation.z = side * -.11;
    const joint = add(new THREE.CylinderGeometry(.105, .105, .065, 40), darkAlloy, [side * .18, .56, 0], cup);
    joint.rotation.z = Math.PI / 2;
    const screw = add(new THREE.CylinderGeometry(.029, .029, .07, 20), alloy, [side * .22, .56, 0], cup);
    screw.rotation.z = Math.PI / 2;

    // Minimal embossed maker's mark, constructed as bars so it remains crisp.
    for (let i = 0; i < 3; i++) {
      add(new RoundedBoxGeometry(.009, .14 + i * .038, .027, 2, .009), alloy,
        [side * .296, 0, -.047 + i * .047], cup);
    }
    if (side === 1) {
      const control = add(new THREE.CylinderGeometry(.067, .067, .09, 32), alloy, [.19, -.30, .52], cup);
      control.rotation.x = Math.PI / 2;
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2;
        add(new THREE.SphereGeometry(.006, 4, 3), darkAlloy, [.19 + Math.cos(a) * .067, -.30 + Math.sin(a) * .067, .568], cup);
      }
      add(new RoundedBoxGeometry(.025, .015, .07, 2, .006), glow, [.19, -.52, .36], cup);
      add(new RoundedBoxGeometry(.08, .025, .02, 3, .009), rubber, [.08, -.70, .14], cup);
    }
  }
  product.rotation.y = -.12;
  return product;
}

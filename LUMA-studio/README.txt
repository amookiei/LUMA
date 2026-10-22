LUMA — Product Render Studio

브라우저에서 제품 3D 모델을 불러와 스튜디오 조명으로 렌더링하는 도구입니다.

실행
Node.js 22 이상에서 이 폴더를 열고 다음 순서로 실행하세요.
  npm install
  npm run build
  npm run dev
브라우저: http://127.0.0.1:4173
완성된 dist 폴더는 일반 정적 웹 호스팅에도 배포할 수 있습니다.

주요 기능
- GLB / GLTF + BIN·텍스처 / OBJ + MTL·텍스처 / STL 업로드
- 차콜 역광, 밝은 소프트 스튜디오, 앰버 역광
- 모델 회전, 카메라 회전·이동·확대, 노출·조명 방향·강도·렌즈 조절
- 원래 재질 유지 / 전체 재질 사용자 설정
- 히어로·정면·측면·후면·상단·디테일의 일괄 PNG 생성
- 히어로 컷은 현재 조절한 카메라 구도 사용
- 1:1 / 4:5 / 16:9, 최대 긴 변 4096 px, 투명 PNG
- 실시간 PBR / 64·256 샘플 GPU 패스 트레이싱
- 개별 PNG 및 전체 ZIP 저장, 중단 시 완료 이미지 보존

참고 사항
모델 파일은 네트워크로 전송되지 않고 브라우저 안에서만 처리됩니다.
갤러리는 탭의 메모리에 보관됩니다. 탭을 닫기 전에 다운로드하세요.
첫 정밀 렌더링은 GPU 프로그램 준비에 시간이 걸릴 수 있습니다.
출력 품질과 속도는 입력 모델의 디테일·재질·텍스처 및 GPU 성능에 따라 달라집니다.
300 MB를 넘는 전체 파일은 불러올 수 없습니다.
인스턴스가 있는 모델, 150만 삼각형 초과 모델, 지원되지 않는 GPU는
정밀 출력 대신 실시간 PBR을 사용하며 갤러리에 대체 출력이라고 표시합니다.
KTX2 압축 텍스처는 지원하지 않습니다. PNG/JPG 텍스처를 포함한 GLB로 다시 내보내세요.
STEP, IGES, 3DM, BLEND 등 CAD·DCC 원본은 GLB/OBJ/STL로 변환하세요.
웹 외부 경로를 참조하는 모델은 필요한 파일을 함께 선택해야 합니다.

라이브러리
Three.js https://threejs.org/
GPU Path Tracer https://github.com/gkjohnson/three-gpu-pathtracer
three-mesh-bvh https://github.com/gkjohnson/three-mesh-bvh
fflate https://github.com/101arrowz/fflate
각 라이브러리의 라이선스 고지는 dist/app.js.LEGAL.txt와 원본 패키지에 포함됩니다.

검증
실제 브라우저에서 4종 모델 업로드, 조명 프리셋 변경, 6컷 생성,
1080px 64샘플 패스 트레이싱, ZIP 저장, 3277×4096 RGBA PNG 저장을 확인했습니다.

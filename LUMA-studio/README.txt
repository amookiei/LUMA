LUMA — Product Render Studio

브라우저에서 제품 3D 모델을 불러와 스튜디오 조명으로 렌더링하고,
결과를 프로젝트별 갤러리(데이터베이스)에 보관하는 도구입니다.

실행
Node.js 22.13 이상에서 이 폴더를 열고 다음 순서로 실행하세요.
  npm install
  npm run build        # src → dist 번들
  npm start            # dist 정적 파일 + /api 서버 (SQLite 자동 생성, server/cli.mjs)
브라우저: http://127.0.0.1:4173
개발 중에는 npm run dev 로 빌드와 서버 실행을 한 번에 할 수 있습니다.
테스트: npm test (API·DB 통합 테스트, node:test)

dist 폴더만 일반 정적 호스팅에 올려도 동작합니다. 이 경우 /api 가 없으므로
갤러리·조명 룩·저장 구도는 브라우저 탭 메모리에만 보관됩니다(헤더에 표시).
서버가 떠 있어도 저장소를 열 수 없으면(읽기 전용 파일 시스템 등) 같은 방식으로
정적 모드로 동작하며 /api/health 가 {ok:false, reason} 으로 이유를 알려 줍니다.

Vercel 배포
- vercel.json 이 dist 를 정적으로 배포하도록 고정합니다(Root Directory: LUMA-studio).
  Vercel 함수는 SQLite 파일을 보관할 수 없으므로 DB 모드는 Vercel에서 켜지지 않고,
  앱은 자동으로 탭 메모리 모드로 동작합니다.
- 프로젝트 루트에 server.mjs 같은 파일을 두지 마세요. Vercel이 이를 서버리스 함수로
  감지해 실행하다 실패하면 사이트 전체가 500(FUNCTION_INVOCATION_FAILED)이 됩니다.
  서버 진입점은 server/cli.mjs 입니다.
- DB 모드가 필요하면 Node를 상시 실행할 수 있는 호스트(Railway, Fly.io, Render, 자체 VM)에
  npm start 로 배포하거나, Supabase 를 연결하세요(아래).

Supabase 연동 (3D 모델 · 렌더 · 룩 · 구도를 계정별 클라우드 저장소에 보관)
- 스키마: supabase/migrations/20261022000000_luma_studio.sql (Postgres 테이블 + RLS + Storage 버킷 + RPC)
- 어댑터: src/supabase-api.js. 빌드 시 LUMA_SUPABASE_URL / LUMA_SUPABASE_ANON_KEY 가 있으면
  app.js 가 SQLite 서버 대신 Supabase 를 사용합니다. 로컬은 .env(.env.example 참고), Vercel 은
  Environment Variables 에 같은 이름으로 넣고 재배포하세요.
- 이 모드에서는 불러온 3D 모델이 프로젝트에 자동 저장되고(같은 파일은 중복 업로드하지 않음),
  왼쪽 ‘저장된 모델’ 목록에서 다시 불러오거나 삭제할 수 있습니다. 렌더에는 사용한 모델이 연결됩니다.
- 브라우저가 Supabase 에 직접 연결하므로 Vercel 정적 배포에서도 DB 모드를 쓸 수 있습니다.
- 가이드: docs/supabase.md (설정 순서, 동작 방식, 자주 쓰는 쿼리)

데이터베이스
- 별도 설치 없이 Node 내장 SQLite(node:sqlite)를 사용합니다.
- 기본 위치: ./data/luma.sqlite, 렌더 PNG: ./data/renders/<project>/<render>.png
- 스키마 마이그레이션은 server/db.mjs 의 MIGRATIONS 배열에 버전을 추가하면
  서버 시작 시 순서대로 적용됩니다.
- 저장 항목
  projects      프로젝트(이름, 마지막 모델 이름)
  renders       렌더 결과 메타데이터(컷, 프리셋, 크기, 엔진, 샘플 수, 당시 설정 JSON) + 파일 경로
  looks         사용자가 저장한 조명 룩(기준 프리셋 + 조명/재질/효과 설정)
  camera_views  프로젝트별 저장 구도(카메라 위치·타깃·업 벡터·초점 거리)
- 모델 파일(GLB/OBJ/STL)은 서버로 전송되지 않습니다. 렌더 결과 PNG만 저장됩니다.

환경 변수
  PORT                 포트 (기본 4173)
  HOST                 바인드 주소 (기본 127.0.0.1, 네트워크 공개는 0.0.0.0)
  LUMA_DATA_DIR        데이터 폴더 (기본 ./data)
  LUMA_DB_PATH         SQLite 파일 경로 (기본 <LUMA_DATA_DIR>/luma.sqlite)
  LUMA_MAX_UPLOAD_MB   렌더 업로드 최대 크기 (기본 96)

REST API (server/routes.mjs)
  GET    /api/health
  GET    /api/projects                     POST /api/projects {name, modelName?}
  GET    /api/projects/:id                 PATCH /api/projects/:id   DELETE /api/projects/:id
  GET    /api/projects/:id/renders         DELETE /api/projects/:id/renders (갤러리 비우기)
  POST   /api/projects/:id/renders         본문: PNG 바이트, Content-Type: image/png,
                                           헤더 X-Luma-Render: encodeURIComponent(JSON 메타데이터)
  GET    /api/renders/:id                  GET /api/renders/:id/image   DELETE /api/renders/:id
  GET    /api/looks                        POST /api/looks {name, basePreset, settings}   DELETE /api/looks/:id
  GET    /api/projects/:id/views           POST /api/projects/:id/views {name, camera}    DELETE /api/views/:id

주요 기능
- GLB / GLTF + BIN·텍스처 / OBJ + MTL·텍스처 / STL 업로드
- 라이팅 프리셋 5종: 차콜 림 라이트, 소프트 스튜디오, 앰버 글로우, 스틸 블루, 아이보리 웜
- 조명 룩 저장: 현재 조명·재질·효과 설정을 이름 붙여 저장하고 다시 적용
- 모델 회전, 카메라 회전·이동·확대, 노출·조명 방향·강도·렌즈 조절
- 피사계 심도(조리개 f/1–16): 패스 트레이싱 품질에서 회전 중심에 초점
- 구도 저장: 직접 잡은 카메라 구도를 컷으로 추가해 함께 일괄 렌더링
- 원래 재질 유지 / 전체 재질 사용자 설정
- 히어로·정면·측면·후면·상단·디테일 + 저장 구도의 일괄 PNG 생성
- 후처리 효과: 비네팅, 필름 그레인, 워터마크(두 엔진 공통, 미리보기 반영)
- 360° 턴테이블: 현재 구도를 기준으로 12/24/36/72 프레임 시퀀스를 ZIP으로 저장
- 1:1 / 4:5 / 16:9, 최대 긴 변 4096 px, 투명 PNG
- 실시간 PBR / 64·256 샘플 GPU 패스 트레이싱
- 프로젝트별 갤러리: 개별 PNG·전체 ZIP 저장, 개별 삭제, 새로고침 후에도 유지

렌더 기능을 추가하는 방법 (src/)
- 새 라이팅 프리셋: presets.js 의 LIGHTING_PRESETS 에 항목 추가.
  조명 강도·색·소프트박스 배열·카드 이미지(또는 그라디언트)만 적으면
  렌더러와 UI 카드가 자동으로 반영됩니다.
- 새 고정 컷(카메라 앵글): views.js 의 BUILTIN_VIEWS 에 방향 벡터와 라벨 추가.
- 새 후처리 효과: effects.js 의 EFFECTS 에 {id, label, kind, apply(ctx, w, h, value)} 추가.
  효과 탭 컨트롤, 썸네일, 최종 PNG, 저장되는 설정 스냅샷에 자동으로 포함됩니다.
- 렌더러 설정 항목(예: 새 슬라이더): renderer.js 의 SETTING_RANGES 와 this.settings 기본값에
  키를 추가하고 _applyLighting / _applyMaterial 에서 사용한 뒤, index.html 에 같은 id 의
  입력을 두면 app.js 가 값을 동기화합니다.
- 시퀀스형 출력(턴테이블 등): renderer.capture({camera}) 에 getCameraState()/orbitedCameraState()
  로 만든 카메라 상태를 넘기면 어떤 궤적이든 프레임 단위로 렌더링할 수 있습니다.

참고 사항
렌더링은 항상 이 기기의 GPU에서 처리됩니다. 모델 파일은 SQLite 서버 모드와 정적 모드에서는 기기 밖으로
나가지 않으며, Supabase 모드에서만 내 계정의 비공개 Storage 에 저장됩니다.
서버 없이 정적으로 열면 갤러리는 탭의 메모리에 보관됩니다. 탭을 닫기 전에 다운로드하세요.
첫 정밀 렌더링은 GPU 프로그램 준비에 시간이 걸릴 수 있습니다.
피사계 심도는 ‘빠르게 · 실시간’ 품질에서는 적용되지 않습니다.
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
- npm test: 프로젝트·렌더 업로드/다운로드/삭제·용량 제한·룩·구도·마이그레이션 8개 통합 테스트 통과
- 헤드리스 Chromium(SwiftShader)에서 서버 모드로 프리셋 전환, 룩 저장, 구도 저장, 2컷 실시간 렌더링,
  새로고침 후 갤러리·룩·구도 복원, 개별 다운로드·삭제, 프로젝트 생성·전환, 24프레임 턴테이블 ZIP 확인
- 정적 호스팅 모드(API 없음)에서 탭 메모리 폴백 확인

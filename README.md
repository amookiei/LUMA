# LUMA — Product Render Studio

브라우저에서 제품 3D 모델(GLB · GLTF · OBJ · STL)을 불러와 스튜디오 조명으로 렌더링하고,
결과를 프로젝트별 갤러리에 보관하는 웹 앱입니다. 모델 파일은 기기 밖으로 나가지 않고,
렌더 결과만 서버의 SQLite 데이터베이스에 저장됩니다.

```bash
cd LUMA-studio
npm install
npm run build   # src → dist
npm start       # http://127.0.0.1:4173  (정적 파일 + /api, data/luma.sqlite 자동 생성)
npm test        # API·DB 통합 테스트
```

자세한 실행 방법, 환경 변수, REST API, 데이터베이스 구조,
그리고 **렌더 기능을 추가하는 방법**은 [`LUMA-studio/README.txt`](LUMA-studio/README.txt)를 참고하세요.

## 구성

| 경로 | 역할 |
| --- | --- |
| `LUMA-studio/src/app.js` | UI·상태·프로젝트/갤러리 동기화 |
| `LUMA-studio/src/renderer.js` | Three.js 미리보기 + GPU 패스 트레이싱 출력 |
| `LUMA-studio/src/presets.js` | 라이팅 프리셋 레지스트리 (항목 추가 = 새 룩) |
| `LUMA-studio/src/views.js` | 고정 카메라 컷 레지스트리 |
| `LUMA-studio/src/effects.js` | 후처리 효과 레지스트리 (비네팅·그레인·워터마크) |
| `LUMA-studio/src/api.js` | 서버 API 클라이언트 (서버가 없으면 탭 메모리로 폴백) |
| `LUMA-studio/server/` | Node 22 HTTP 서버, SQLite 스키마·마이그레이션, REST 라우트 |
| `LUMA-studio/test/` | `node:test` 기반 통합 테스트 |
| `LUMA-studio/supabase/migrations/` | Supabase 스키마(3D 모델·렌더·룩·구도, RLS, Storage 버킷, RPC) |
| `LUMA-studio/docs/supabase.md` | Supabase 연동 가이드 |

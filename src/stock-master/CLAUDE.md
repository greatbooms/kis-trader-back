# Stock Master Module

## 책임
KIS가 제공하는 종목 마스터 파일(KOSPI/KOSDAQ + NASD/NYSE/AMEX/SEHK/SHAA/SZAA/TKSE/HASE/VNSE)을 다운로드·파싱·인메모리 보관. 종목 검색(자동완성)과 종목명 fallback에 사용.

## 주요 서비스 / 컴포넌트
- `stock-master.module.ts` — `StockMasterService`/`StockMasterResolver` (export는 service만)
- `stock-master.service.ts` — `OnModuleInit`에서 마스터 다운로드. `@Cron('0 0 8 * * *', Asia/Seoul)`로 매일 08:00 갱신. `searchStocks(keyword, market?, limit, exchangeCode?)` — 키워드 부분일치 검색
- `stock-master.resolver.ts` — `searchStocks` query (인증 가드)
- `dto/`, `types/` — `StockSearchResult`, `SearchStocksInput`, `StockInfo`

## 외부 의존성
- `axios` — KIS CDN(`new.real.download.dws.co.kr`)에서 mst/cod zip 파일 다운로드
- `zlib` — gzip 압축 해제
- `fs`/`path` — `.stock-master-tmp/` 임시 디렉토리에 저장
- `@nestjs/schedule` — daily refresh
- `AuthModule` (resolver의 `GqlAuthGuard`만 사용 — module import 아님)

## 주의사항 / 비자명한 규칙
- **다운로드 URL은 KIS CDN 고정**: 한국투자증권이 매일 갱신하는 ZIP. 포맷이 바뀌면 파싱 실패 — 마스터 파일별 컬럼 너비/위치(domestic은 고정 길이, overseas는 탭 구분)는 `parseDomesticMaster`/`parseOverseasMaster`에서 하드코딩됨
- **임시 파일 위치**: `process.cwd()/.stock-master-tmp/` — Docker 컨테이너에서 working dir 권한 확인 필요
- 부팅 시 다운로드 실패해도 `logger.warn`만 — 다음 cron(다음날 08:00)에 재시도. 그동안 검색은 빈 결과
- **`StockMasterService` export만**: resolver는 같은 모듈 내부용. 다른 모듈은 service의 `searchStocks`/`getStockInfo` 메서드 직접 사용 (예: `ScreeningCandidateCollector`가 종목명 fallback에 사용)
- 검색은 in-memory 배열 linear scan — 종목 수 제한적(국내 ~3000, 해외 합산 ~수만)이라 충분히 빠름
- `exchangeCode` 인자로 거래소별 필터링 가능 (KRX, NASD, NYSE, AMEX, SEHK, SHAA, SZAA, TKSE, HASE, VNSE)

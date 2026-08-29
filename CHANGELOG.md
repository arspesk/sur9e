# Changelog

## [0.5.1](https://github.com/arspesk/sur9e/compare/v0.5.0...v0.5.1) (2026-08-29)


### Bug Fixes

* **providers:** discover user-installed CLIs ([#126](https://github.com/arspesk/sur9e/issues/126)) ([75343f8](https://github.com/arspesk/sur9e/commit/75343f8c8d2c14ed706a6cd24eea7f689c8cd30c))

## [0.5.0](https://github.com/arspesk/sur9e/compare/v0.4.1...v0.5.0) (2026-08-26)


### Features

* **chat:** add confirm-gated update_offer for metadata and batch report edits ([2fdd8af](https://github.com/arspesk/sur9e/commit/2fdd8afaaa0f084f241a3f7accfd4a509d179050))
* **chat:** preserve stopped-reply history and add Send now for queued messages ([#109](https://github.com/arspesk/sur9e/issues/109)) ([0e87a51](https://github.com/arspesk/sur9e/commit/0e87a516f40884550f21e8705487b9d3ba7c220f))
* **chat:** render thought bodies as markdown with a lightbulb glyph ([b8aaa9f](https://github.com/arspesk/sur9e/commit/b8aaa9f956a980cbe60a6ef1ed86a1cffff3f47c))
* **chat:** unify attachment validation and add DOCX support ([744d8a7](https://github.com/arspesk/sur9e/commit/744d8a747f3835fa30e2986ce7e5e8863ff87fda))
* **chat:** unify thinking, tools, and stages into an activity stream ([#110](https://github.com/arspesk/sur9e/issues/110)) ([fdabbfb](https://github.com/arspesk/sur9e/commit/fdabbfb85ad189d9da89eede59e18f19d16ddb90))


### Bug Fixes

* **agent:** give get_tracker server-side filters, compact rows, and pagination ([#108](https://github.com/arspesk/sur9e/issues/108)) ([6426dec](https://github.com/arspesk/sur9e/commit/6426dece9cc02b71fbaaffb3461df4614f710ebf))
* **batch:** accept screen JSON when stream-formatter trailers follow the fence ([00d7cb6](https://github.com/arspesk/sur9e/commit/00d7cb6335ae985c3958c16d3dce765df331e37f))
* **chat:** center scroll-to-bottom button icon ([65f2eb5](https://github.com/arspesk/sur9e/commit/65f2eb5509b9284885f1c5c09cad0ea4f2affc6c))
* **chat:** keep a tool detail hugging its name in the activity timeline ([#114](https://github.com/arspesk/sur9e/issues/114)) ([5fc3956](https://github.com/arspesk/sur9e/commit/5fc3956c5eec623a91b0b3dd0428889c6a989370))
* **editor:** strip editor internals from copied report HTML ([360bdd3](https://github.com/arspesk/sur9e/commit/360bdd38426a84580fcb95d047812ec3e95f766e))
* **followups:** exclude interview-stage offers from the follow-up tracker ([8b76304](https://github.com/arspesk/sur9e/commit/8b763048819d9a1df3429457ea09a874122ee93b))
* **modes:** nest all interview rounds under one heading depth ([#123](https://github.com/arspesk/sur9e/issues/123)) ([c843425](https://github.com/arspesk/sur9e/commit/c843425d458846b5ab97efa11403e8e6e3b58cbf))
* **providers:** classify an expired Claude OAuth session as auth in chat and job error banners ([#121](https://github.com/arspesk/sur9e/issues/121)) ([eade73e](https://github.com/arspesk/sur9e/commit/eade73e9ce168402f4e596f1dda39c61e30f5c8b))
* **providers:** classify Claude monthly spend limit as quota ([b147e31](https://github.com/arspesk/sur9e/commit/b147e3112a69863606c572352ce3e05d306e334f))
* **providers:** classify Claude OAuth session expiry as retryable auth error ([#119](https://github.com/arspesk/sur9e/issues/119)) ([d5cb6f0](https://github.com/arspesk/sur9e/commit/d5cb6f0d9f19b64deff4db33fb16d10fb070ab71))
* **tracker:** preserve original added date on re-eval ([ef59b7d](https://github.com/arspesk/sur9e/commit/ef59b7d71e9f50a80b9085595d2f4112e7cc5169))
* **web:** stop hiding ChatGPT-only models from the Codex model picker ([95caa9e](https://github.com/arspesk/sur9e/commit/95caa9e57752b7e520e74cb6ab30e184c945cccf))
* **web:** unify page widths on shared tokens and calm the caps ([#113](https://github.com/arspesk/sur9e/issues/113)) ([8e994d7](https://github.com/arspesk/sur9e/commit/8e994d7ebb944e54cb6aacf46fda3dc870c0a16a))
* **web:** widen desktop layout caps on home and chat ([ae99662](https://github.com/arspesk/sur9e/commit/ae99662f35364d96e6e472227d814b08df85ad80))

## [0.4.1](https://github.com/arspesk/sur9e/compare/v0.4.0...v0.4.1) (2026-08-02)


### Bug Fixes

* **update:** install build dependencies in production ([1e0d872](https://github.com/arspesk/sur9e/commit/1e0d872d6eca0d009d0592e7e5259005691b152b))
* **update:** recover failed updates safely ([efbd0d5](https://github.com/arspesk/sur9e/commit/efbd0d56a2bbd2a56baf97301faecffc190e6ec1))

## [0.4.0](https://github.com/arspesk/sur9e/compare/v0.3.2...v0.4.0) (2026-08-02)


### Features

* add guided status follow-ups and safe updates ([e458cc4](https://github.com/arspesk/sur9e/commit/e458cc42923a307db16829642b20451c53ac92a4))
* **status:** guide interview and offer preparation ([6932308](https://github.com/arspesk/sur9e/commit/6932308870fab19a95f90723b58cd93ac8319da1))
* **triage:** add GitHub issue triage workflow ([13cc864](https://github.com/arspesk/sur9e/commit/13cc864aff8c5b5c4b3b5309091da081471d9aca))
* **update:** add resilient one-click self-updates ([6182b8a](https://github.com/arspesk/sur9e/commit/6182b8ad3263d0aae1a5081b591d262c7ecf9069))
* **update:** check automatically on settings entry ([dc717b8](https://github.com/arspesk/sur9e/commit/dc717b82f85543f7b2b2d0e3a683415966e7e84c))


### Bug Fixes

* **chat:** expose read-only Playwright tools ([b6703ba](https://github.com/arspesk/sur9e/commit/b6703ba907595a950c402dfb2291280c8cd4e469))
* **chat:** harden persisted offer workflows ([e690025](https://github.com/arspesk/sur9e/commit/e690025f7d9f5f97502b29d62a212031da87a080))
* **chat:** repair offer workflows and provider fallbacks ([f6de816](https://github.com/arspesk/sur9e/commit/f6de81627c3562bf5d30d1ec8ac1a2c0f065d251))
* **offers:** hide chat launcher behind filters ([e710b67](https://github.com/arspesk/sur9e/commit/e710b67d62a33c09da1423fcd27ea82600c7acd3))
* **pipeline:** refine card scores and action menus ([39cb29f](https://github.com/arspesk/sur9e/commit/39cb29fb52c831f1e6bdc0b0d2098d0e792c93bf))
* **providers:** recover from hung retryable failures ([ca24bae](https://github.com/arspesk/sur9e/commit/ca24bae48df4229a8e98193680a5acf6f8a63ab6))
* **settings:** reduce numeric stepper size ([14b363a](https://github.com/arspesk/sur9e/commit/14b363ad651efc3edf60e0049d2742291c45d8b9))
* **status:** save evaluated before optional follow-up ([3b7b6cd](https://github.com/arspesk/sur9e/commit/3b7b6cd126fe80797d786acf8260b68995d6c906))


### Reverts

* split bundled improvements into logical changes ([6be7e37](https://github.com/arspesk/sur9e/commit/6be7e372a5dd53de5a8885e25637d561b21a7479))

## [0.3.2](https://github.com/arspesk/sur9e/compare/v0.3.1...v0.3.2) (2026-07-30)


### Bug Fixes

* **chat:** compact attachments and narrow file tracing ([babbc85](https://github.com/arspesk/sur9e/commit/babbc85426ce994f26c38802fcf84f7429e4ce70))
* **chat:** restore full-page file drops ([0a041a5](https://github.com/arspesk/sur9e/commit/0a041a519464cc775cb877af258876e28bfae044))

## [0.3.1](https://github.com/arspesk/sur9e/compare/v0.3.0...v0.3.1) (2026-07-30)


### Bug Fixes

* **chat:** add dependency-aware MCP mode orchestration ([8ca039f](https://github.com/arspesk/sur9e/commit/8ca039f5c972a7717baae9c24be1e6f1c8590a3a))

## [0.3.0](https://github.com/arspesk/sur9e/compare/v0.2.0...v0.3.0) (2026-07-29)


### Features

* **chat:** add job cancellation and text offer workflows ([fe5c798](https://github.com/arspesk/sur9e/commit/fe5c798d2b69e681035c1600fa5a21f8663b8ca4))
* polish chat workflows and dashboard UX ([64bcf1a](https://github.com/arspesk/sur9e/commit/64bcf1ab2c53fa93923db030074491303223bf94))


### Bug Fixes

* **chat:** don't render a thinking chip with nothing in it ([957345e](https://github.com/arspesk/sur9e/commit/957345e261b6c5d4090c521e3a7501d9cf0e3416))
* **deps:** pin @hookform/resolvers to 5.4.0 ([a980c01](https://github.com/arspesk/sur9e/commit/a980c01a25c058b349ad579c9a9680aab9f03f37))

Release Please manages notable changes in this project. Earlier releases are available on the [sur9e releases page](https://github.com/arspesk/sur9e/releases).

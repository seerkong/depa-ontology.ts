# 通用可解释推理

Mission G2-T2 授权创建独立公共包，auto 问答、manual commit。使用真实 Cozo 关系求值与 depa-datalog 安全构造能力，补齐规则协议、有限域校验、支持图、预算和 epoch 重算；不依赖 Ontology 对象模型，不写领域事实，不包含组织规则。覆盖 D01-D09 通用推理场景；回放循环属于上层。必须通过 macOS arm64 Node.js/Bun，以及四包的 tarball 独立消费。命令 npm run test:inference、npm run test:inference:package、npm run test:datalog。

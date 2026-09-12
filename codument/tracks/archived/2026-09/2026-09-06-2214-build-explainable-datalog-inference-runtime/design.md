# 设计

四包边界为 contract（数据）、logic（校验/编译/支持图）、cozo-support（可抛弃 mem DB IO）、capsule（默认 runtime 装配）。Logic 接受 runtime.evaluate 与 runtime.now。每个 epoch 冻结输入并重新计算；规则仅允许标量常量与绑定变量，无函数生成新值、无 IO。否定只针对不会由规则写入的冻结关系，禁止负递归。

Cozo 单次 Datalog 固定点求全部事实，再在同一查询输出各规则实例的直接前提、结论与负前提缺席证据。规则与事实指纹确定性计算；解释按图遍历，环不会枚举无限路径。重复推导保留独立 support，多前提在同一 support 中表达 AND，不拆为 OR。输入 source 引用保持为字符串。

程序/输入/输出规模与时间预算超过限制产生 invalid 或 incomplete，永不以空冲突冒充成功。native :timeout 实际终止查询；输出行 limit 与 JS facts/supports 上限控制材料大小，native 内部中间状态不承诺硬内存隔离。生产需要进程内存硬隔离时在部署边界加进程预算。包发行候选准备但不发布 npm。


## 规模与终止验收

真实实验要求 input-only relation 直接 inline，不增加 Horn alias。100/1000 深链及 100/1000/10000 高扇出在 5 秒预算内完成；10000 深链采用 1 秒预算，必须显式 incomplete/TIMEOUT 且 5 秒内结束，不能宣称全量推理成功。Cozo native timeout 是合作取消，support 增加独立 worker process，超时 kill 并等待 exit，避免后台 native 继续运行。只测 RSS 变化，不承诺硬内存配额。结果和解释携带 programFingerprint、inputFingerprint、epoch。

# 词境 Lexi

词境是一个在 Windows、Linux / WSL2 本地运行的英语单词学习网站。它以**单词的具体词义**为学习单位，通过阅读、场景写作、听写和复习，帮助你从“认识单词”走向“会在合适的语境里使用”。口语练习暂未开放。

## 快速开始

> 面向 **Windows、Linux / WSL2 本地使用**，不是在线托管服务。GitHub 仓库提供源码，不附带 Node.js、依赖、API 密钥或个人学习数据。

### Linux / WSL2 快速启动

安装 Linux 版 Node.js ≥ 22.13.0 和 npm，推荐将源码放到 `~/projects/lexi-english`，不要与 Windows 共用依赖或运行数据。执行以下命令：

```bash
mkdir -p ~/projects
cd ~/projects
git clone https://github.com/Mleon7/lexi-english.git lexi-english
cd lexi-english
npm run install:ci
cp .env.example .env  # 已有配置时不要覆盖
nano .env            # 填写 DeepSeek 密钥，选择 MiniMax 或本地 Qwen3-TTS
npm run local:start
```

在浏览器访问启动输出的登录地址，默认为 `http://localhost:5173/signin-with-chatgpt?return_to=/`。WSL2 可使用 Windows 浏览器访问。后台服务关闭与查询：

```bash
npm run local:status
npm run local:stop
```

启动入口会自动迁移数据库并同步媒体副本；关闭终端或浏览器不会停止后台服务。WSL 关闭后需重新启动应用。详细说明见 [使用说明](使用说明.md)。

### Windows 快速启动

### 1. 获取源码与安装依赖

准备 Git、Windows x64 的 Node.js 和 npm。`package.json` 要求 Node.js ≥ 22.13.0；当前本地验证版本为 25.0.0，其他版本需自行验证。

在 PowerShell 中执行（也可以通过 GitHub 的 **Code → Download ZIP** 下载并解压）：

```powershell
git clone https://github.com/Mleon7/lexi-english.git lexi-english
Set-Location .\lexi-english
npm.cmd run install:ci

# 双击启动入口需要项目内的 runtime\node.exe
New-Item -ItemType Directory -Force .\runtime | Out-Null
Copy-Item (Get-Command node.exe).Source .\runtime\node.exe

Copy-Item .env.example .env
```

以上复制的是系统已安装的 Windows x64 Node.js。若已有 `.env`，请勿覆盖。

### 2. 填写 API 密钥

编辑项目根目录的 `.env`，填写 `DEEPSEEK_API_KEY`。语音默认使用 MiniMax，需要 `MINIMAX_API_KEY`；也可以使用下面的本地 Qwen3-TTS。场景图片仍需 MiniMax 密钥，在线服务调用会消耗相应账户额度。

### 3. 启动与关闭

双击 `启动词境.cmd`，等待初始化数据库并自动打开浏览器。默认地址为 `http://127.0.0.1:5173/`，端口占用时会自动选择其他端口，以启动窗口为准。

使用结束后双击 `关闭词境.cmd`，不要仅关闭浏览器。详细配置、备份和故障排查见 [使用说明](使用说明.md)。

## 使用本地 Qwen3-TTS

安装好 `qwen-tts-demo` 的 **CustomVoice** 模型后，在词境的 `.env` 中设置（目录按实际安装位置修改）：

```dotenv
TTS_PROVIDER=qwen3
QWEN_TTS_URL=http://127.0.0.1:8000
QWEN_TTS_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice
QWEN_TTS_DIR=/mnt/e/ai/qwen3-tts
QWEN_TTS_OFFLINE=1
```

然后执行 `npm run local:stop` 和 `npm run local:start`。启动入口会同时启动词境与 Qwen，显示加载进度，等待两项服务都就绪。刷新词境，进入“听”并点击音色。语音由本机生成，无需 MiniMax 语音密钥；DeepSeek 和场景图片仍使用各自的在线服务。

`npm run local:stop` 会同时关闭由词境启动的 Qwen 并释放显存。已运行的 Qwen 会被复用，关闭词境时保留；不设置 `QWEN_TTS_DIR` 时需自行启动 Qwen。模型加载日志在 `.local-run/qwen-tts.log`。使用 VS Code Remote Tunnel 时，只需转发词境端口；词境后端通过本地地址访问 Qwen。安装、启动及故障排查见 [本地语音配置](使用说明.md#本地-qwen3-tts)。

## 学习流程

配置完成后，双击 `启动词境.cmd`，浏览器会自动打开；使用结束后双击 `关闭词境.cmd`。关闭浏览器不会停止后台程序。

为了营造英文环境，界面文字全部为英文：学习空间、真实场景、温故知新分别显示为 Learn、Real Scenes、Review。选词义和真实场景查词时，中文释义默认隐藏，悬停或轻点图标查看。

1. **选词义**：添加英文单词，按英文释义选择这次要学习的意思（中文释义悬停查看）。同一个单词可以学习多个词义。
2. **读**：阅读英文描述、三个例句及近义词、反义词例句。可以追加材料、翻译和图片；提示默认隐藏，悬停或轻点图标查看。
3. **写**：根据英文场景造句，获得词义、语境和语法反馈。中文场景翻译需主动生成，再悬停查看。造句通过后，修正为自然英语的版本会自动加入例句；同一场景重新检查时替换之前加入的那句。
4. **听**：进入页面自动准备三个随机音色选项，点击播放例句并听写。提交后才能悬停查看原句；可以增加音色。英文描述不参与听写。
5. **复习**：先根据英文场景填空，答对后自行选择语境造一个全新的句子。重点考核词义与使用场景，允许轻微语法错误。复习内容和反馈使用英文，提供按需翻译。自主造句通过后，修正后的句子同样加入例句。
6. **真实场景**：粘贴自己想读的歌词或文章。导入时默认勾选「One sentence per line」，DeepSeek 会把跨行的一句话合并、把挤在一行的几句话拆开，只移动换行，不改动任何单词。保存文本后，DeepSeek 会先标出其中的词组和固定搭配（如 ran into、figure it out），阅读时点其中任一个词就整体查询，也可以在词义卡片里拆开单独查某个词。读：轻点单词（或拖选短语），按所在句子判断词义，可加入单词本，原句会成为它的例句；已学过的词义会被识别，不会重复加入。写：按轻/中/重随机挖空默写，写完一段就能单独检查、揭晓或重填这一段，不用等全部写完；重复出现的行不会再挖空，只跟随第一次出现的位置显示。

学习页左侧单词栏支持拖拽：向左拖到底收起，从左边缘向右拖展开。

## 界面预览

以下为本地运行的真实页面截图。点击图片可查看原图。

| 听 · 多音色听写 | 读 · 语境阅读 |
| --- | --- |
| [![听写界面：三个音色与提交后解锁原句](docs/screenshots/listen.jpg)](docs/screenshots/listen.jpg) | [![阅读界面：英文描述、例句与近反义词](docs/screenshots/read.jpg)](docs/screenshots/read.jpg) |

| 写 · 英文场景造句 | 复习 · 语境填空 |
| --- | --- |
| [![写作界面：英文场景、翻译入口与造句输入](docs/screenshots/write.jpg)](docs/screenshots/write.jpg) | [![复习界面：英文场景与单词填空](docs/screenshots/review.jpg)](docs/screenshots/review.jpg) |

复习填空答对后进入自主造句，学习者自行选择使用场景。

读界面的提示默认隐藏，悬停在例句下方的对应图标上才显示。以下展示中文翻译和场景图片的提示效果，也支持聚焦或轻点图标查看。

| 读 · 悬停查看中文翻译 | 读 · 悬停查看场景图片 |
| --- | --- |
| [![读界面中文翻译提示：例句的中文翻译浮层](docs/screenshots/read-translation.jpg)](docs/screenshots/read-translation.jpg) | [![读界面场景图片提示：例句的 MiniMax 生成图片与说明](docs/screenshots/read-image.jpg)](docs/screenshots/read-image.jpg) |

## 工作原理

- **DeepSeek**：提供词义、学习材料、英文场景、中文翻译和造句评估，也为图片编写场景提示词。
- **语音**：支持 MiniMax 或本地 Qwen3-TTS CustomVoice，将英文例句转成不同音色。首次播放时生成，后续复用已保存文件。
- **MiniMax 图片**：按需生成场景图片，与语音服务选择独立。
- **本地应用与存储**：React/Vinext 提供页面和接口，通过本地 D1/SQLite 与 R2 模拟存储保存学习记录和媒体。普通媒体副本自动导出到 `media/images`、`media/audio`，使用“单词_日期_时间_毫秒”命名。
- **复习抽样**：每个词义单独记录熟悉度。答对填空且自主造句通过后，后续抽中概率降低；失败则提高复习优先级。

网站运行在本机，但并非完全离线：生成与评估时，相关单词、练习文本或生成提示会发送给对应的模型服务商。请勿提交敏感内容。当前登录是本地模拟身份，不是真正登录 ChatGPT；学习数据不会自动同步到在线版。该身份机制不适合直接用于公网或多用户部署。

## 技术栈与目录

- **前端**：React 19、TypeScript、Tailwind CSS 4。
- **应用框架**：Vinext / Vite，采用 Next.js 风格的路由与接口。
- **数据存储**：Drizzle ORM、本地 Cloudflare D1 / R2 模拟存储。
- **模型服务**：DeepSeek 文本生成与评估、MiniMax 或本地 Qwen3-TTS 语音、MiniMax 图片生成。

```text
app/                 页面与 API 接口
components/learning/ 阅读、写作、听写、复习及共享组件
components/ui/       基础界面组件
lib/                 学习逻辑、模型调用与存储
scripts/             安装、启动、构建与媒体导出
drizzle/             数据库迁移
tests/               自动化测试
docs/screenshots/    界面截图
.env.example         环境变量样例
```

## 文档与反馈

- [部署与使用说明](使用说明.md)：详细配置、日常操作、备份恢复、开发命令与 GitHub 发布注意事项。
- 欢迎通过 Issues 反馈问题，附上复现步骤、Node.js 版本和脱敏后的错误信息；不要附带 `.env`、个人数据库或完整私人学习材料。
- 当前口语练习尚未开放；公网部署不在现有说明的覆盖范围内。Linux / WSL2 使用 npm 启停，Windows 也可使用双击入口。

仓库只保存程序、文档、配置样例和界面截图。密钥、学习数据、生成媒体、运行环境及依赖保留在本地，Git 版本记录不能替代数据备份。

## 开发检查

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

测试使用本地模拟数据，不需要真实 API 密钥。`npm test` 已包含 TypeScript 和 VM Modules 所需的 Node.js 参数。GitHub Actions 会在 Windows 和 Linux 的 Node.js 22.13.0、24 环境执行上述检查。

## 许可证

本项目采用 [MIT License](LICENSE)。随仓库附带的第三方代码保留各自的许可证，见 `build/sites-vite-plugin.LICENSE` 和 `vendor/shadcn-tailwind-4.13.0.LICENSE.md`。

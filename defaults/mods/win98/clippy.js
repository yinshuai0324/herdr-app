// The Office Assistant, floating over the desktop. When an agent needs you
// (blocked) or finished while you looked away (done), it pops a balloon that
// takes you there. Click it for a tip. Display Properties (or its balloon)
// hides it; Start > Programs > Accessories brings it back.

import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, run, shared, setShared, placement } from "herdr";
import { C, ASSETS, unit, root, button, label, sfx, own } from "./kit.js";

const TIPS = [
  "看起来你正在管理代理。\n\n按 Ctrl+Esc 可以打开开始菜单。",
  "点击正在显示的标签页在任务栏上的按钮可将其最小化。再次点击即可恢复。",
  "按 Ctrl+Shift+Esc 可打开「关闭程序」，查看并结束 Herdr 中的终端。",
  "右键点击桌面上的文件夹，可重命名或关闭相应工作区。",
  "代理还在处理？桌面上有扫雷，可以休息一下。",
  "双击标题栏可最大化窗口，再双击一次即可还原。",
  "用「开始 › 运行」可以在新窗口执行命令。",
  "选择「关闭 › 以 DOS 模式重启」可以切换到终端布局。",
  "注销后会回到 Herdr 的常规布局。",
];

export default class Clippy {
  init() {
    this.dismissed = new Set();
    this.tip = null;
  }

  news() {
    const list = agents()
      .filter((a) => (a.status === "blocked" || a.status === "done") && !a.focused)
      .filter((a) => !this.dismissed.has(`${a.address}:${a.status}`))
      .sort((a, b) => (a.status === "blocked") - (b.status === "blocked") || a.seq - b.seq);
    return list.pop() ?? null;
  }

  render(_cx) {
    if (shared("win98.clippy") === "off") return div();
    const u = unit();
    const a = this.news();
    const right = placement()?.edge !== "left";
    let balloon = null;
    if (a) {
      const name = a.program?.name ?? a.app ?? "你的代理";
      const where = `'${a.space_name} \\ ${a.tab_name}'`;
      const text =
        a.status === "blocked"
          ? `看起来 ${name} in\n${where} 正在等你。

需要帮忙吗？`
          : `看起来 ${name} 已在以下工作区完成任务：${where}。

要查看它做了什么吗？`;
      balloon = this.balloon(u, text, [
        ["前往查看", () => {
          run("agent.focus", { terminal: a.address });
          this.dismissed.add(`${a.address}:${a.status}`);
        }],
        ["暂时不用", () => this.dismissed.add(`${a.address}:${a.status}`)],
      ]);
    } else if (this.tip !== null) {
      balloon = this.balloon(u, TIPS[this.tip % TIPS.length], [
        ["下一条提示", () => (this.tip = (this.tip + 1) % TIPS.length)],
        ["关闭", () => (this.tip = null)],
        ["隐藏助手", () => setShared("win98.clippy", "off")],
      ]);
    }
    // Clean the dismissed list once their agents moved on.
    for (const k of [...this.dismissed]) {
      const [addr, st] = k.split(":");
      if (!agents().some((x) => x.address === addr && x.status === st)) this.dismissed.delete(k);
    }
    const clip = own(
      div()
        .id("clippy")
        .relative()
        .flex_none()
        .cursor_pointer()
        .when(Boolean(a), (el) => el.loop("top", { from: 0, to: u(-5), period: 800 }))
        .on_click((_e, cx) => {
          this.tip = this.tip === null ? Math.floor(Math.random() * TIPS.length) : null;
          sfx("clippy");
          cx.notify();
        })
        .child(image(`${ASSETS}/img/clippy.svg`).w(u(64)).h(u(80))),
    );
    return root(
      u,
      v_flex()
        .p(u(4))
        .gap(u(2))
        .map((el) => (right ? el.items_end() : el.items_start())),
    )
      .when(Boolean(balloon), (el) => el.child(balloon))
      .child(clip);
  }

  balloon(u, text, actions) {
    return v_flex()
      .w(u(200))
      .p(u(8))
      .gap(u(8))
      .bg(C.tip)
      .border(u(1))
      .border_color(C.text)
      .rounded(u(8))
      .child(
        v_flex().children(
          String(text)
            .split("\n")
            .map((l) => div().child(l || " ")),
        ),
      )
      .child(
        v_flex()
          .gap(u(3))
          .children(
            actions.map(([t, fn], i) =>
              own(
                h_flex()
                  .id(`clip-${i}`)
                  .gap(u(5))
                  .items_center()
                  .cursor_pointer()
                  .on_click((_e, cx) => {
                    fn();
                    cx.notify();
                  })
                  .child(div().w(u(7)).h(u(7)).rounded(u(4)).bg(C.navy))
                  .child(div().text_color(C.navy).underline().child(t)),
              ),
            ),
          ),
      );
  }
}

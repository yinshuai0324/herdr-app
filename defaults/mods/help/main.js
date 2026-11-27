// The keybind list (Herdr's prefix+?), grouped, filterable by typing.
// Reads keys.json through keys(); edit keys.json to change any of them.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { keys, props, closeOverlay, theme } from "herdr";

const GROUPS = [
  ["工作区", /^space\./],
  ["标签页", /^tab\./],
  ["窗格", /^pane\./],
  ["代理", /^agent\./],
  ["终端", /^terminal\.|^send:/],
  ["窗口与应用", /./],
];

const ACTION_NAMES = {
  "space.new": "新建工作区", "space.select": "切换工作区", "space.next": "下一个工作区", "space.prev": "上一个工作区",
  "space.close": "关闭工作区", "space.rename": "重命名工作区",
  "tab.new": "新建标签页", "tab.select": "切换标签页", "tab.next": "下一个标签页", "tab.prev": "上一个标签页",
  "tab.move": "移动标签页", "tab.close": "关闭标签页", "tab.rename": "重命名标签页",
  "pane.split": "分屏", "pane.close": "关闭窗格", "pane.zoom": "放大或还原窗格", "pane.go": "聚焦窗格", "pane.swap": "交换窗格", "pane.resize": "调整窗格大小",
  "agent.next": "下一个代理", "agent.prev": "上一个代理", "agent.select": "切换代理",
  "terminal.copy": "复制", "terminal.paste": "粘贴", "terminal.paste_image": "粘贴图片", "terminal.select_all": "全选终端内容",
  "terminal.scroll": "滚动终端", "terminal.search": "查找终端内容",
  "mod.open": "打开扩展", "layout.toggle": "显示或隐藏区域",
  "app.palette": "命令面板", "app.settings": "设置", "app.quit": "退出 Herdr", "app.help": "键盘快捷键",
  "app.hide": "隐藏 Herdr", "app.hide_others": "隐藏其他应用", "app.show_all": "显示全部应用",
  "app.zoom_in": "放大", "app.zoom_out": "缩小", "app.zoom_reset": "重置缩放",
};
const ARG_NAMES = {
  left: "左", right: "右", up: "上", down: "下", sidebar: "侧栏", agents: "代理",
  picker: "工作区选择器", files: "文件", changes: "更改",
};

function label(action) {
  if (action.startsWith("send:")) return "输入 " + JSON.stringify(action.slice(5));
  const [name, arg] = action.split(":");
  const title = ACTION_NAMES[name] ?? name;
  return arg ? `${title} · ${ARG_NAMES[arg] ?? arg}` : title;
}

export default class Help extends View {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "输入内容以筛选…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  render(cx) {
    const t = theme();
    const f = this.filter.toLowerCase();
    const all = keys().filter((k) => !f || k.keys.includes(f) || label(k.action).toLowerCase().includes(f) || k.action.includes(f));
    const seen = new Set();
    const groups = GROUPS.map(([name, re]) => {
      const rows = all.filter((k) => !seen.has(k) && re.test(k.action) && (seen.add(k) || true));
      return [name, rows];
    }).filter(([, rows]) => rows.length > 0);
    return v_flex()
      .id("help")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") return closeOverlay(props().overlay);
      })
      .size_full()
      .min_h(0)
      .p(18)
      .gap(14)
      .bg(t.popover)
      .text_size(12)
      .child(
        h_flex()
          .h(22)
          .items_center()
          .justify_between()
          .child(div().text_size(15).font_semibold().text_color(t.foreground).child("键盘快捷键"))
          .child(div().id("help-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => closeOverlay(props().overlay)).child("Esc")),
      )
      .child(Input.new(this.input).h(36).flex_none().px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .py(2)
          .gap(10)
          .children(
            groups.map(([name, rows]) =>
              v_flex()
                .gap(2)
                .child(div().text_size(11.5).font_medium().text_color(t.dim).child(name))
                .children(
                  rows.map((k) =>
                    h_flex()
                      .h(32)
                      .px(8)
                      .rounded(7)
                      .items_center()
                      .child(div().w(190).text_color(t.accent).child(k.keys + (k.section !== "global" ? `  (${k.section})` : "")))
                      .child(div().text_color(t.foreground).child(label(k.action))),
                  ),
                ),
            ),
          ),
      );
  }
}

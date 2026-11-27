import { View, div } from "gpui-kit";
import { Input, InputState, h_flex, v_flex } from "gpui-base";
import { appHome, closeOverlay, pickFolder, props, readTextFile, run, theme } from "herdr";

const storageKey = "last-project";
const fields = {
  host: ["IP 地址", "192.168.1.20"],
  username: ["SSH 用户名", "远端账号"],
  port: ["SSH 端口", "22"],
  directory: ["本机项目目录", "选取 Mac 上的项目"],
};

function button(id, label, primary, action) {
  const t = theme();
  return h_flex().id(id).h(32).px(12).items_center().rounded(8).border_1()
    .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5)
    .cursor_pointer().hover(style => style.opacity(0.88)).on_click(action).child(label);
}

export default class LanWorkspace extends View {
  init(_props, cx) {
    let prior;
    try { prior = JSON.parse(localStorage.getItem(storageKey) || "{}"); }
    catch { prior = {}; }
    this.inputs = Object.fromEntries(Object.entries(fields).map(([key, [_label, placeholder]]) => {
      const state = InputState.new({ value: prior[key] ?? (key === "port" ? "22" : ""), placeholder });
      state.on("submit", () => this.connect(cx));
      return [key, state];
    }));
    this.busy = false;
    this.remember = prior.remember === true;
    this.error = "";
    this.inputs.host.focus();
  }

  chooseFolder(cx) {
    cx.spawn(async cx => {
      try {
        const directory = await pickFolder({ prompt: "选取本机项目" });
        if (directory) this.inputs.directory.set_value(directory);
      } catch {
        this.error = "无法打开目录选择器。";
      }
      cx.notify();
    });
  }

  connect(cx) {
    if (this.busy) return;
    const values = Object.fromEntries(Object.entries(this.inputs).map(([key, field]) => [key, field.value().trim()]));
    const { host, username, port, directory } = values;
    if (!host || !username || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !directory.startsWith("/")) {
      this.error = "请填写 IP、用户名和端口，并选择本机项目。";
      cx.notify();
      return;
    }
    this.error = "";
    this.busy = true;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const runtime = JSON.parse(await readTextFile(appHome() + "/mods/lan-workspace/runtime.json"));
        const project = { ...values, remember: this.remember };
        localStorage.setItem(storageKey, JSON.stringify(project));
        const name = directory.split("/").filter(Boolean).pop() || "共享项目";
        closeOverlay(props().overlay);
        run("space.new", {
          name: name + " · " + host,
          folder: directory,
          machine: "",
          tab: "远端 SSH",
          argv: [runtime.node, runtime.workspace, JSON.stringify({
            ...project, keychain: runtime.keychain, stateDir: runtime.stateDir, smbServer: runtime.smbServer,
          })],
        });
      } catch {
        this.error = "无法读取共享目录运行配置，请用 Herdr 局域网启动器打开。";
        this.busy = false;
        cx.notify();
      }
    });
  }

  field(key, accessory) {
    const t = theme();
    return v_flex().flex_1().gap(5)
      .child(div().text_size(12).text_color(t.muted).child(fields[key][0]))
      .child(h_flex().gap(8).items_center()
        .child(Input.new(this.inputs[key]).flex_1().h(34).px(9).rounded(8).border_1()
          .border_color(t.input).bg(t.background).text_color(t.foreground).text_size(13))
        .when(Boolean(accessory), row => row.child(accessory)));
  }

  render() {
    const t = theme();
    const p = props();
    return v_flex().id("lan-workspace").w_full().min_h(0).p(18).gap(12)
      .bg(t.popover).text_color(t.foreground)
      .child(div().text_size(16).font_semibold().child("连接并挂载本机项目"))
      .child(h_flex().gap(8).child(this.field("host")).child(this.field("username")).child(this.field("port")))
      .child(this.field("directory", button("lan-folder", "选取…", false, (_event, cx) => this.chooseFolder(cx))))
      .child(h_flex().id("lan-remember").items_center().gap(8).cursor_pointer()
        .on_click((_event, cx) => { this.remember = !this.remember; cx.notify(); })
        .child(div().size(16).rounded(4).border_1().border_color(t.input)
          .text_size(12).text_color(t.accent).child(this.remember ? "✓" : ""))
        .child(div().text_size(12).child("在这台 Mac 上记住 SSH 密码")))
      .child(div().text_size(12).text_color(this.error ? t.blocked : t.muted)
        .child(this.error || "首次连接时，在工作区终端确认 SSH 指纹并输入密码。"))
      .child(h_flex().justify_end().gap(8)
        .child(button("lan-cancel", "取消", false, () => closeOverlay(p.overlay)))
        .child(button("lan-connect", this.busy ? "正在打开…" : "连接并挂载", true, (_event, cx) => this.connect(cx))));
  }
}

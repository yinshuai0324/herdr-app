import { View, div } from "gpui-kit";
import { Input, InputState, h_flex, v_flex } from "gpui-base";
import { closeOverlay, machines, openOverlay, pickFolder, props, run, setShared, shared, theme } from "herdr";

const hostsKey = "lan-workspace.hosts";
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

function hosts() {
  const entries = shared(hostsKey);
  return Array.isArray(entries) ? entries : [];
}

function validAddress(host) {
  if (host.includes(":")) return /^[a-f0-9:.]+(?:%[a-z0-9_.-]+)?$/i.test(host);
  const parts = host.split(".");
  return parts.length === 4 && parts.every(part => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

export default class LanWorkspace extends View {
  init(_props, cx) {
    const p = props();
    this.action = p?.action ?? "pick";
    this.entry = hosts().find(host => host.id === p?.hostId);
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.at = 0;
    if (this.action !== "add" && this.action !== "edit") return;
    let prior = this.entry;
    if (!prior) {
      try { prior = JSON.parse(localStorage.getItem(storageKey) || "{}"); }
      catch { prior = {}; }
    }
    this.inputs = Object.fromEntries(Object.entries(fields).map(([key, [_label, placeholder]]) => {
      const state = InputState.new({ value: String(prior[key] ?? (key === "port" ? "22" : "")), placeholder });
      state.on("submit", (_event, cx) => this.save(cx));
      return [key, state];
    }));
    this.remember = this.entry?.remember ?? true;
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

  save(cx) {
    const values = Object.fromEntries(Object.entries(this.inputs).map(([key, field]) => [key, field.value().trim()]));
    const { host, username, port, directory } = values;
    if (!validAddress(host) || !/^[a-zA-Z0-9._-]{1,64}$/.test(username) ||
        !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535 ||
        !directory.startsWith("/") || directory === "/") {
      this.error = "请填写有效的 IP、SSH 用户名和端口，并选取本机项目目录。";
      cx.notify();
      return;
    }
    const all = hosts();
    if (all.some(row => row.id !== this.entry?.id && row.host === host && row.username === username &&
        row.port === Number(port) && row.directory === directory)) {
      this.error = "此主机和共享目录已经添加。";
      cx.notify();
      return;
    }
    const project = directory.split("/").filter(Boolean).pop() || "共享项目";
    const endpoint = Number(port) === 22 ? host : (host.includes(":") ? `[${host}]:${Number(port)}` : `${host}:${Number(port)}`);
    const entry = {
      id: this.entry?.id ?? Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
      name: `${project} · ${username}@${endpoint}`,
      host, username, port: Number(port), directory, remember: this.remember,
    };
    setShared(hostsKey, this.entry ? all.map(row => row.id === entry.id ? entry : row) : [...all, entry]);
    localStorage.setItem(storageKey, JSON.stringify(values));
    this.close();
  }

  close() {
    closeOverlay(props().overlay);
  }

  targets() {
    return [
      { machine: "", title: "本机" },
      ...machines().filter(machine => machine.name && machine.layout === "ready")
        .map(machine => ({ machine: machine.name, title: machine.name })),
      ...hosts().map(host => ({ machine: "lan:" + host.id, title: host.name, detail: host.directory })),
      { title: "添加主机…" },
    ];
  }

  select(target) {
    this.close();
    if (target.machine === undefined) run("mod.open", { name: "machine-add" });
    else run("space.new", { machine: target.machine });
  }

  key(event, cx) {
    if (event.key === "escape") this.close();
    else if (this.action === "pick") {
      const targets = this.targets();
      this.at = Math.min(this.at, targets.length - 1);
      if (event.key === "enter") this.select(targets[this.at]);
      else if (event.key === "up") this.at = (this.at + targets.length - 1) % targets.length;
      else if (event.key === "down") this.at = (this.at + 1) % targets.length;
      else return;
      cx.notify();
    } else return;
    cx.stop_propagation();
  }

  picker(t) {
    return v_flex().min_h(0).gap(8)
      .child(div().text_size(16).font_semibold().child("新建工作区"))
      .child(div().text_size(12).text_color(t.muted).child("选择终端运行的主机"))
      .child(v_flex().id("lan-targets").max_h(350).min_h(0).gap(2).overflow_y_scroll()
        .children(this.targets().map((target, index) => h_flex().id("lan-target-" + (target.machine ?? "add"))
          .px(10).py(7).gap(8).items_center().rounded(7)
          .when(index === this.at, el => el.bg(t.hover))
          .cursor_pointer().hover(s => s.bg(t.hover)).on_click(() => this.select(target))
          .child(v_flex().flex_1().min_w(0).gap(3)
            .child(div().truncate().text_size(13).child(target.title))
            .when(Boolean(target.detail), el => el.child(div().truncate().text_size(11).text_color(t.muted).child(target.detail))))
          .when(Boolean(target.detail), el => el.child(div().text_size(11).text_color(t.muted).child("共享目录"))))));
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
    const root = v_flex().id("lan-workspace").w_full().min_h(0).p(18).gap(12)
      .track_focus(this.handle).on_key_down((event, cx) => this.key(event, cx))
      .bg(t.popover).text_color(t.foreground);
    if (this.action === "pick") return root.child(this.picker(t));
    if ((this.action === "edit" || this.action === "remove") && !this.entry) {
      return root.child(div().text_size(13).child("找不到该共享目录主机。"))
        .child(h_flex().justify_end().child(button("lan-close", "关闭", false, () => this.close())));
    }
    if (this.action === "remove") {
      return root.child(div().text_size(16).font_semibold().child("移除共享目录主机？"))
        .child(div().text_size(12).text_color(t.muted).child(this.entry.name))
        .child(h_flex().justify_end().gap(8)
          .child(button("lan-cancel", "取消", false, () => this.close()))
          .child(button("lan-remove", "移除", true, () => {
            setShared(hostsKey, hosts().filter(row => row.id !== this.entry.id));
            this.close();
          })));
    }
    return root
      .child(div().text_size(16).font_semibold().child(this.action === "edit" ? "编辑共享目录主机" : "添加主机"))
      .when(this.action === "add", el => el.child(h_flex().gap(6).items_center().text_size(12)
        .child(div().id("lan-ordinary-ssh").px(10).py(5).rounded(6).cursor_pointer().text_color(t.muted)
          .hover(s => s.bg(t.hover).text_color(t.foreground)).on_click(() => {
            this.close();
            run("mod.open", { name: "machine-add" });
          }).child("SSH 主机"))
        .child(div().px(10).py(5).rounded(6).bg(t.hover).child("SSH（共享目录）"))))
      .child(h_flex().gap(8).child(this.field("host")).child(this.field("username")).child(this.field("port")))
      .child(this.field("directory", button("lan-folder", "选取…", false, (_event, cx) => this.chooseFolder(cx))))
      .child(h_flex().id("lan-remember").items_center().gap(8).cursor_pointer()
        .on_click((_event, cx) => { this.remember = !this.remember; cx.notify(); })
        .child(div().size(16).rounded(4).border_1().border_color(t.input)
          .text_size(12).text_color(t.accent).child(this.remember ? "✓" : ""))
        .child(div().text_size(12).child("在这台 Mac 上记住 SSH 密码")))
      .child(div().text_size(12).text_color(this.error ? t.blocked : t.muted)
        .child(this.error || "在新建工作区时选择此主机。首次连接请在终端确认 SSH 指纹并输入密码。"))
      .child(h_flex().justify_end().gap(8)
        .child(button("lan-cancel", "取消", false, () => this.close()))
        .child(button("lan-save", "保存主机", true, (_event, cx) => this.save(cx))));
  }
}

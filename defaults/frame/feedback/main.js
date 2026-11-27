import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, props, closeOverlay, feedbackPreview, feedbackWebhook, feedbackPasteImage, feedbackPickImages, feedbackAttachImages, feedbackClearImages, sendFeedback } from "herdr";

const MAX_SHOTS = 3;

export default class Feedback extends View {
  init(_props, cx) {
    this.message = TextareaState.new({ value: props()?.message ?? "", placeholder: "发生了什么？你希望看到什么结果？", rows: 4 });
    this.email = InputState.new({ placeholder: "电子邮箱（选填）" });
    this.direct = feedbackPreview("", "", 0).direct;
    this.configuring = this.direct && props()?.configure === true;
    this.webhookReady = false;
    this.webhookBusy = false;
    this.editingWebhook = false;
    this.webhookError = null;
    this.message.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    this.email.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    // A paste with no text: a screenshot, if the clipboard holds one.
    this.message.on("paste_other", (_e, cx) => {
      if (this.direct || this.sending || this.sent) return;
      if (this.shots.length >= MAX_SHOTS) this.error = "最多添加 3 张截图。";
      else this.add([feedbackPasteImage()].filter(Boolean));
      cx.notify();
    });
    feedbackClearImages();
    this.shots = [];
    this.sending = false;
    this.sent = false;
    this.error = null;
    this.handle = cx.focus_handle();
    if (this.configuring) {
      this.webhookUrl = InputState.new({ placeholder: "接收地址（Webhook）" });
      this.webhookUrl.set_masked(true);
      this.webhookSecret = InputState.new({ placeholder: "签名密钥（选填）" });
      this.webhookSecret.set_masked(true);
      this.handle.focus();
    } else {
      this.message.focus();
    }
    if (this.direct) this.webhookAction("status", cx);
  }

  close() { closeOverlay(props()?.overlay); }

  webhookAction(action, cx) {
    if (this.webhookBusy || this.sending) return;
    this.webhookBusy = true;
    this.webhookError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.webhookReady = action === "save"
          ? await feedbackWebhook(action, this.webhookUrl.value(), this.webhookSecret.value())
          : await feedbackWebhook(action);
        if (action !== "status") {
          this.editingWebhook = false;
          this.webhookUrl.set_value("");
          this.webhookSecret.set_value("");
        }
      } catch (e) {
        this.webhookError = String(e.message ?? e);
      }
      this.webhookBusy = false;
      cx.notify();
    });
  }

  renderWebhookSettings(t, field) {
    const form = this.editingWebhook || !this.webhookReady;
    return v_flex().id("feedback-receiver").track_focus(this.handle).w_full().min_h(0)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.close(); cx.stop_propagation(); } })
      .child(div().px(24).py(18).cursor_grab().text_size(19).font_semibold().text_color(t.foreground).child("反馈接收设置"))
      .child(v_flex().px(24).gap(10).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().text_size(13).text_color(t.muted).child(form ? "接收地址和签名密钥保存在本机钥匙串。" : "已保存接收地址。"))
        .when(form, (panel) => panel
          .child(field(Input.new(this.webhookUrl)).h(38))
          .child(field(Input.new(this.webhookSecret)).h(38)))
        .when(Boolean(this.webhookError), (panel) => panel.child(div().text_size(13).text_color(t.accent).child(this.webhookError))))
      .child(h_flex().px(24).py(16).gap(8).justify_end().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(this.button(t, "feedback-webhook-close", "关闭", () => this.close()))
        .when(form, (row) => row.child(this.button(t, "feedback-webhook-save", "保存", (_e, cx) => this.webhookAction("save", cx), true, this.webhookBusy)))
        .when(!form, (row) => row
          .child(this.button(t, "feedback-webhook-forget", "移除", (_e, cx) => this.webhookAction("forget", cx), false, this.webhookBusy))
          .child(this.button(t, "feedback-webhook-edit", "更换", (_e, cx) => {
            this.editingWebhook = true;
            cx.notify();
          }, true, this.webhookBusy))));
  }

  /** Takes `{ path }`s up to the limit; the first `{ error }` is shown. */
  add(results) {
    this.error = null;
    for (const r of results) {
      if (r.error) this.error = r.error;
      else if (this.shots.length >= MAX_SHOTS) this.error = "最多添加 3 张截图。";
      else this.shots.push(r.path);
    }
  }

  pick(cx) {
    cx.spawn(async (cx) => {
      try { this.add(await feedbackPickImages()); }
      catch (e) { this.error = String(e.message ?? e); }
      cx.notify();
    });
  }

  shots_row(t) {
    const thumb = (path, i) => div().id(`shot-${i}`).relative().h(72).rounded(6).overflow_hidden().border_1().border_color(t.border)
      .child(image(path).h(72))
      .child(div().id(`shot-x-${i}`).absolute().top(4).right(4).size(20).rounded(10).bg(t.raised).text_color(t.foreground)
        .flex().items_center().justify_center().text_size(12).cursor_pointer()
        .on_click((_e, cx) => { this.shots.splice(i, 1); this.error = null; cx.notify(); }).child("×"));
    return h_flex().w_full().gap(8).items_center()
      .children(this.shots.map(thumb))
      .when(this.shots.length < MAX_SHOTS, (el) => el.child(this.button(t, "feedback-add", "添加截图", (_e, cx) => this.pick(cx))));
  }

  button(t, id, label, action, primary = false, disabled = false) {
    return div().id(id).px(14).py(7).rounded(7).border_1().border_color(t.border)
      .bg(primary && !disabled ? t.accent : t.raised)
      .text_color(primary && !disabled ? t.accent_foreground : t.muted)
      .cursor_pointer().on_click((e, cx) => { if (!disabled) action(e, cx); }).child(label);
  }

  send(body, cx) {
    if (this.sending || this.sent) return;
    this.sending = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try { this.error = await sendFeedback(body, this.shots); this.sent = !this.error; }
      catch (e) { this.error = String(e.message ?? e); }
      this.sending = false;
      cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    const preview = feedbackPreview(this.message.value(), this.email.value(), this.shots.length);
    const body = preview.body;
    const available = this.direct ? this.webhookReady && !this.webhookBusy : preview.available;
    const disabled = !available || this.sending || !this.message.value().trim();
    const label = (text) => div().text_size(13).text_color(t.muted).child(text);
    const field = (el) => el.w_full().p(10).rounded(7).border_1().border_color(t.border).bg(t.background).text_color(t.foreground).text_size(14);
    if (this.configuring) return this.renderWebhookSettings(t, field);
    return v_flex().id("feedback").track_focus(this.handle).w_full().min_h(0).h(this.direct ? 390 : 650)
      .on_drop((e, cx) => {
        if (this.direct || this.sending || this.sent) return;
        if (this.shots.length >= MAX_SHOTS) this.error = "最多添加 3 张截图。";
        else this.add(feedbackAttachImages(e.paths.slice(0, MAX_SHOTS - this.shots.length)));
        cx.notify();
      })
      .on_key_down((e, cx) => { if (e.key === "escape") { this.close(); cx.stop_propagation(); } })
      // The title drags the window; everything below keeps its presses (selecting text).
      .child(div().flex_none().px(24).py(18).cursor_grab().text_size(19).font_semibold().text_color(t.foreground).child("发送反馈"))
      .when(!this.direct && !preview.available, (el) => el.child(div().flex_none().px(24).pb(12).text_size(13).text_color(t.accent).child("此源码构建版无法发送反馈。请使用正式发布版。")))
      .child(v_flex().id("feedback-body").on_mouse_down("left", (_e, cx) => cx.stop_propagation()).flex_1().flex_shrink(1).min_h(0).overflow_y_scrollbar().px(24).gap(10)
        .when(props()?.from === "agent", (el) => el.child(div().p(10).rounded(7).bg(t.raised).text_color(t.accent).text_size(14).child("这份草稿由代理生成，请在发送前核对。")))
        .when(this.sent, (el) => el.child(div().py(20).text_size(16).text_color(t.foreground).child("已发送。感谢你帮助改进多点终端。")))
        .when(!this.sent, (el) => el
          .when(this.direct && !available && !this.webhookBusy, (form) => form.child(label(this.webhookError ?? "请在「设置 › 隐私」配置反馈接收地址。")))
          .child(label(this.direct ? "反馈内容最多 4000 字符。" : "反馈内容最多 4000 字符。可以粘贴或拖入截图，最多 3 张。"))
          .child(field(Textarea.new(this.message)).h(130))
          .when(!this.direct, (form) => form.child(this.shots_row(t)))
          .child(label("如需回复，可填写电子邮箱。"))
          .child(field(Input.new(this.email)).h(40))
          .when(!this.direct, (form) => form
            .child(label("发送内容包括下方 JSON 和上面的截图。日志和安装 ID 不会发出。"))
            .child(v_flex().w_full().p(10).rounded(7).border_1().border_color(t.border).bg(t.background)
              .children(JSON.stringify(body, null, 2).split("\n").map((line) => div().text_size(11).line_height("15px").text_color(t.dim).child(line)))))))
      .when(Boolean(this.error), (el) => el.child(div().flex_none().px(24).pt(10).text_size(13).text_color(t.accent).child(this.error)))
      .child(h_flex().flex_none().px(24).py(16).gap(10).justify_end().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(this.button(t, "feedback-cancel", this.sent ? "完成" : "取消", () => this.close()))
        .when(!this.sent, (el) => el.child(this.button(t, "feedback-send", this.sending ? "正在发送…" : "发送", (_e, cx) => this.send(body, cx), true, disabled))));
  }
}

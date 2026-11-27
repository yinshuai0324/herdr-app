use gpui::*;
use herdr_shell::action::ShellAction;

actions!(herdr, [Quit, Hide, HideOthers, ShowAll, Settings]);

pub fn init(cx: &mut App) {
    cx.on_action(|_: &Quit, cx| cx.quit());
    cx.on_action(|_: &Hide, cx| cx.hide());
    cx.on_action(|_: &HideOthers, cx| cx.hide_other_apps());
    cx.on_action(|_: &ShowAll, cx| cx.unhide_other_apps());
    cx.on_action(|_: &Settings, _| crate::mods::request(crate::mods::Request::Run { name: "app.settings".into(), args: serde_json::Value::Null }));
    refresh_menus(cx);
}

pub fn action(name: &str) -> Option<Box<dyn Action>> {
    match name {
        "app.quit" => Some(Box::new(Quit)),
        "app.hide" => Some(Box::new(Hide)),
        "app.hide_others" => Some(Box::new(HideOthers)),
        "app.show_all" => Some(Box::new(ShowAll)),
        "app.settings" => Some(Box::new(Settings)),
        _ => None,
    }
}

/// Builds the menu bar again. macOS takes each item's key from the keymap
/// when the bar is built, so this runs after keys.json loads, and when the
/// layouts or the shown layout change.
pub fn refresh_menus(cx: &mut App) {
    let shown = crate::mods::shared("layout").and_then(|v| v.as_str().map(str::to_owned));
    cx.set_menus(menus(&crate::window::layout_names(), shown.as_deref()));
}

/// An item that runs a command as keys.json names it (`pane.split:right`).
/// It is the same action as the key's, so the item shows the person's key.
fn command(title: &str, command: &str) -> MenuItem {
    MenuItem::Action {
        name: title.to_owned().into(),
        action: action(command).unwrap_or_else(|| Box::new(ShellAction::new(command.to_owned()))),
        os_action: None,
        checked: false,
        disabled: false,
    }
}

/// Menu items keep the terminal command's shortcut, but editing belongs to
/// a focused control that handles editing. Other focus keeps the terminal fallback.
pub fn dispatch_edit(action: &ShellAction, terminal_focused: bool, window: &mut Window, cx: &mut App) -> bool {
    if terminal_focused {
        return false;
    }
    let action: Box<dyn Action> = match action.id() {
        "terminal.copy" => Box::new(gpui_base::input::Copy),
        "terminal.paste" => Box::new(gpui_base::input::Paste),
        _ => return false,
    };
    if !window.is_action_available(action.as_ref(), cx) {
        return false;
    }
    window.dispatch_action(action, cx);
    true
}

/// GPUI registers the localized Window menu as the app's windows menu, so
/// macOS adds its own window items there (tiling, the window list).
pub(crate) fn menus(layouts: &[String], shown: Option<&str>) -> Vec<Menu> {
    let layout_items = layouts
        .iter()
        .map(|name| {
            let title = match name.as_str() {
                "main" => crate::PRODUCT_NAME,
                "terminals" => "终端",
                "win98" => "多点终端 98",
                _ => name.as_str(),
            };
            command(title, &format!("layout.switch:{name}")).checked(Some(name.as_str()) == shown)
        })
        .chain([MenuItem::separator(), command("切换到下一个布局", "layout.switch")]);
    vec![
        Menu::new(crate::PRODUCT_NAME).items([
            command("更新日志", "app.whats_new"),
            command("检查更新…", "app.settings:updates"),
            MenuItem::separator(),
            command("设置…", "app.settings"),
            MenuItem::separator(),
            MenuItem::os_submenu("服务", SystemMenuType::Services),
            MenuItem::separator(),
            command("隐藏多点终端", "app.hide"),
            command("隐藏其他应用", "app.hide_others"),
            command("显示全部应用", "app.show_all"),
            MenuItem::separator(),
            command("退出多点终端", "app.quit"),
        ]),
        Menu::new("文件").items([
            command("新建标签页", "tab.new"),
            command("新建工作区", "space.new"),
            MenuItem::separator(),
            command("向右分屏", "pane.split:right"),
            command("向下分屏", "pane.split:down"),
            MenuItem::separator(),
            command("重命名标签页…", "tab.rename"),
            command("重命名工作区…", "space.rename"),
            MenuItem::separator(),
            command("关闭窗格", "pane.close"),
            command("关闭标签页", "tab.close"),
            command("关闭工作区", "space.close"),
        ]),
        Menu::new("编辑").items([
            MenuItem::os_action("复制", ShellAction::new("terminal.copy"), OsAction::Copy),
            MenuItem::os_action("粘贴", ShellAction::new("terminal.paste"), OsAction::Paste),
            MenuItem::separator(),
            command("查找…", "terminal.search"),
        ]),
        Menu::new("视图").items([
            MenuItem::submenu(Menu::new("布局").items(layout_items)),
            command("显示或隐藏侧栏", "layout.toggle:sidebar"),
            command("放大或还原窗格", "pane.zoom"),
            MenuItem::separator(),
            command("实际大小", "app.zoom_reset"),
            command("放大", "app.zoom_in"),
            command("缩小", "app.zoom_out"),
            MenuItem::separator(),
            command("命令面板…", "app.palette"),
        ]),
        Menu::new("窗口").items([
            command("最小化", "window.minimize"),
            command("缩放", "window.maximize"),
            MenuItem::separator(),
            command("跳转到标签页…", "mod.open:picker"),
            command("下一个标签页", "tab.next"),
            command("上一个标签页", "tab.prev"),
            command("下一个工作区", "space.next"),
            command("上一个工作区", "space.prev"),
            command("下一个代理", "agent.next"),
            command("上一个代理", "agent.prev"),
        ]),
        Menu::new("帮助").items([
            command("键盘快捷键", "app.help"),
            command("欢迎使用多点终端", "app.welcome"),
            MenuItem::separator(),
            command("发送反馈…", "app.feedback"),
        ]),
    ]
}

#[cfg(test)]
mod tests {
    // Not `super::*`: gpui's `test` attribute would replace the standard one.
    use super::{ShellAction, menus};
    use gpui::{Action, Keymap, Menu, MenuItem};

    fn actions(items: &[MenuItem], out: &mut Vec<(String, Box<dyn Action>)>) {
        for item in items {
            match item {
                MenuItem::Action { name, action, .. } => out.push((name.to_string(), action.boxed_clone())),
                MenuItem::Submenu(menu) => actions(&menu.items, out),
                _ => {}
            }
        }
    }

    fn all(menus: &[Menu]) -> Vec<(String, Box<dyn Action>)> {
        let mut out = Vec::new();
        for menu in menus {
            actions(&menu.items, &mut out);
        }
        out
    }

    /// A renamed command would leave an item that does nothing.
    #[test]
    fn every_menu_item_runs_a_command() {
        let menus = menus(&["main".into(), "terminals".into()], Some("main"));
        for (title, action) in all(&menus) {
            let Some(shell) = action.as_any().downcast_ref::<ShellAction>() else { continue };
            let (name, value) = shell.id().split_once(':').map_or((shell.id(), None), |(n, v)| (n, Some(v)));
            let c = crate::commands::find(name).unwrap_or_else(|| panic!("{title}: no command {name:?}"));
            if let Some(v) = value {
                assert!(!crate::commands::shorthand(c, v).is_null(), "{title}: {name} takes no {v:?}");
            }
        }
        assert!(menus.iter().any(|m| m.name == "窗口"));
    }

    /// Items show the key the keymap binds to the same command.
    #[cfg(target_os = "macos")]
    #[test]
    fn menu_items_show_the_shipped_keys() {
        let keymap = Keymap::new(crate::keys::parse(crate::keys::DEFAULTS).unwrap());
        let menus = menus(&[], None);
        let items = all(&menus);
        let key = |title: &str| {
            let (_, action) = items.iter().find(|(t, _)| t == title).unwrap();
            keymap.bindings_for_action(action.as_ref()).next().map(|b| b.keystrokes()[0].unparse())
        };
        assert_eq!(key("新建标签页").as_deref(), Some("cmd-t"));
        assert_eq!(key("向右分屏").as_deref(), Some("cmd-d"));
        assert_eq!(key("设置…").as_deref(), Some("cmd-,"));
        assert_eq!(key("退出多点终端").as_deref(), Some("cmd-q"));
        assert_eq!(key("复制").as_deref(), Some("cmd-c"));
        assert_eq!(key("显示或隐藏侧栏").as_deref(), Some("cmd-b"));
        assert_eq!(key("最小化").as_deref(), Some("cmd-m"));
    }

    #[test]
    fn clipboard_items_show_personal_keys() {
        let keymap = Keymap::new(crate::keys::parse(r#"{"global":{"cmd-alt-c":"terminal.copy","cmd-alt-v":"terminal.paste"}}"#).unwrap());
        let items = all(&menus(&[], None));
        for (title, shortcut) in [("复制", "cmd-alt-c"), ("粘贴", "cmd-alt-v")] {
            let (_, action) = items.iter().find(|(name, _)| name == title).unwrap();
            assert_eq!(keymap.bindings_for_action(action.as_ref()).next().unwrap().keystrokes()[0], gpui::KeyBinding::new(shortcut, gpui::NoAction, None).keystrokes()[0]);
        }
    }

    #[test]
    fn the_layout_menu_marks_the_shown_layout() {
        let menus = menus(&["main".into(), "terminals".into()], Some("terminals"));
        let view = menus.iter().find(|m| m.name == "视图").unwrap();
        let Some(MenuItem::Submenu(layouts)) = view.items.first() else { panic!("View starts with Layout") };
        let checked: Vec<String> = layouts
            .items
            .iter()
            .filter_map(|i| match i {
                MenuItem::Action { name, checked: true, .. } => Some(name.to_string()),
                _ => None,
            })
            .collect();
        assert_eq!(checked, ["terminals"]);
    }
}

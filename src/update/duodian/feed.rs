const GITHUB: &str = "https://github.com/";

#[derive(Debug, Eq, PartialEq)]
pub(super) enum Feed {
    Directory(String),
    GitHub(String),
}

impl Feed {
    pub(super) fn parse(url: &str) -> Result<Self, &'static str> {
        if url.contains(['?', '#']) || url.chars().any(char::is_whitespace) {
            return Err("多点终端更新源地址无效。");
        }
        let base = url.trim_end_matches('/');
        if base == GITHUB.trim_end_matches('/') {
            return Err("请填写 GitHub 仓库根地址。");
        }
        if let Some(slug) = base.strip_prefix(GITHUB) {
            let slug = slug.strip_suffix(".git").unwrap_or(slug);
            let (owner, repository) = slug.split_once('/').ok_or("请填写 GitHub 仓库根地址。")?;
            if owner.is_empty() || !owner.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                || matches!(repository, "" | "." | "..")
                || !repository.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
            {
                return Err("请填写 GitHub 仓库根地址。");
            }
            return Ok(Self::GitHub(format!("{GITHUB}{slug}")));
        }
        if url.starts_with("https://") || url.starts_with("file:///") {
            return Ok(Self::Directory(base.to_owned()));
        }
        Err("多点终端更新源必须是 HTTPS 地址或本地目录。")
    }

    pub(super) fn manifest_url(&self) -> String {
        match self {
            Self::Directory(base) => format!("{base}/app/latest.json"),
            Self::GitHub(base) => format!("{base}/releases/latest/download/duodian-latest.json"),
        }
    }

    pub(super) fn archive_url(&self, version: &str, target: &str) -> String {
        match self {
            Self::Directory(base) => format!("{base}/app/{version}/duodian-{target}.tar.gz"),
            Self::GitHub(base) => format!("{base}/releases/download/v{version}/duodian-{target}.tar.gz"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Feed;

    #[test]
    fn github_manifest_is_latest_and_archive_is_pinned_to_the_signed_version() {
        let feed = Feed::parse("https://github.com/Example-Org/duodian-terminal.git").unwrap();
        assert_eq!(feed.manifest_url(), "https://github.com/Example-Org/duodian-terminal/releases/latest/download/duodian-latest.json");
        assert_eq!(feed.archive_url("0.1.22", "macos-aarch64"), "https://github.com/Example-Org/duodian-terminal/releases/download/v0.1.22/duodian-macos-aarch64.tar.gz");
    }

    #[test]
    fn rejects_github_pages_that_are_not_repository_roots() {
        for invalid in ["https://github.com/", "https://github.com/owner", "https://github.com/owner/repo/releases", "https://github.com/owner/..", "https://github.com/owner/repo?token=bad"] {
            assert!(Feed::parse(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn directory_urls_keep_the_existing_layout() {
        for base in ["file:///tmp/updates", "https://example.com/updates"] {
            let feed = Feed::parse(&format!("{base}/")).unwrap();
            assert_eq!(feed.manifest_url(), format!("{base}/app/latest.json"));
            assert_eq!(feed.archive_url("0.1.22", "macos-aarch64"), format!("{base}/app/0.1.22/duodian-macos-aarch64.tar.gz"));
        }
    }
}

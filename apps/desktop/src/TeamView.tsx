import React, { useState, useMemo } from "react";
import type { Team, TeamMember, TeamInvite } from "@sonolect/types";
import type { DictionaryEntry, Snippet } from "./wisprWorkflow";
import { useT } from "./i18n";

export type TeamViewProps = {
  currentTeam: Team | null;
  members: TeamMember[];
  invites: TeamInvite[];
  sharedDictionary: DictionaryEntry[];
  sharedSnippets: Snippet[];
  personalDictionary: DictionaryEntry[];
  personalSnippets: Snippet[];
  userId: string;
  onCreateTeam: (name: string) => void;
  onInvite: (email: string, role: "admin" | "member") => void;
  onRemoveMember: (userId: string) => void;
  onSyncDictionary: () => void;
  onSyncSnippets: () => void;
};

type TeamTab = "members" | "dictionary" | "snippets";

export function TeamView({
  currentTeam,
  members,
  invites,
  sharedDictionary,
  sharedSnippets,
  personalDictionary,
  personalSnippets,
  userId,
  onCreateTeam,
  onInvite,
  onRemoveMember,
  onSyncDictionary,
  onSyncSnippets,
}: TeamViewProps) {
  const [teamName, setTeamName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [activeTab, setActiveTab] = useState<TeamTab>("members");
  const t = useT();

  const currentMember = useMemo(
    () => members.find((m) => m.userId === userId),
    [members, userId],
  );
  const isAdminOrOwner =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  const mergedDictionary = useMemo(() => {
    const merged = new Map<string, DictionaryEntry>();
    for (const entry of personalDictionary) {
      merged.set(entry.spoken.toLowerCase(), entry);
    }
    for (const entry of sharedDictionary) {
      merged.set(entry.spoken.toLowerCase(), entry);
    }
    return [...merged.values()];
  }, [personalDictionary, sharedDictionary]);

  const mergedSnippets = useMemo(() => {
    const merged = new Map<string, Snippet>();
    for (const snippet of personalSnippets) {
      merged.set(snippet.trigger.toLowerCase(), snippet);
    }
    for (const snippet of sharedSnippets) {
      merged.set(snippet.trigger.toLowerCase(), snippet);
    }
    return [...merged.values()];
  }, [personalSnippets, sharedSnippets]);

  const pendingInvites = useMemo(
    () => invites.filter((i) => i.status === "pending"),
    [invites],
  );

  if (!currentTeam) {
    return (
      <section
        className="glass-card management-panel"
        aria-labelledby="team-heading"
      >
        <p className="section-title">{t("team.title")}</p>
        <h3 id="team-heading">{t("team.createOrJoin")}</h3>
        <p>{t("team.description")}</p>

        <div className="form-grid two">
          <label>
            <span>{t("team.teamName")}</span>
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder={t("team.teamNamePlaceholder")}
            />
          </label>
        </div>
        <button
          className="primary-button compact"
          onClick={() => {
            if (teamName.trim()) {
              onCreateTeam(teamName.trim());
              setTeamName("");
            }
          }}
          type="button"
          disabled={!teamName.trim()}
        >
          {t("team.create")}
        </button>
      </section>
    );
  }

  return (
    <section
      className="glass-card management-panel"
      aria-labelledby="team-heading"
    >
      <p className="section-title">{t("team.title")}</p>
      <h3 id="team-heading">{currentTeam.name}</h3>
      <p className="editor-meta">
        {members.length}{" "}
        {members.length === 1
          ? t("team.memberCountSingular")
          : t("team.memberCountPlural")}
      </p>

      <nav className="inline-actions" style={{ marginBottom: "1rem" }}>
        {(["members", "dictionary", "snippets"] as TeamTab[]).map((tab) => (
          <button
            key={tab}
            className={
              activeTab === tab ? "primary-button compact" : "ghost-button"
            }
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {t(`team.tab.${tab}` as Parameters<typeof t>[0])}
          </button>
        ))}
      </nav>

      {activeTab === "members" ? (
        <>
          {isAdminOrOwner ? (
            <div style={{ marginBottom: "1rem" }}>
              <p className="editor-meta" style={{ marginBottom: "0.5rem" }}>
                {t("team.invite")}
              </p>
              <div className="form-grid two">
                <label>
                  <span>{t("team.inviteEmail")}</span>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                  />
                </label>
                <label>
                  <span>{t("team.inviteRole")}</span>
                  <select
                    value={inviteRole}
                    onChange={(e) =>
                      setInviteRole(e.target.value as "admin" | "member")
                    }
                  >
                    <option value="member">{t("team.roleMember")}</option>
                    <option value="admin">{t("team.roleAdmin")}</option>
                  </select>
                </label>
              </div>
              <button
                className="primary-button compact"
                onClick={() => {
                  if (inviteEmail.trim()) {
                    onInvite(inviteEmail.trim(), inviteRole);
                    setInviteEmail("");
                  }
                }}
                type="button"
                disabled={!inviteEmail.trim()}
              >
                {t("team.sendInvite")}
              </button>
            </div>
          ) : null}

          {pendingInvites.length > 0 ? (
            <div style={{ marginBottom: "1rem" }}>
              <p className="editor-meta">{t("team.pendingInvites")}</p>
              {pendingInvites.map((invite) => (
                <article className="preference-row" key={invite.id}>
                  <div>
                    <strong>{invite.email}</strong>
                    <p className="editor-meta">{invite.role}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          <div
            className="preference-list"
            role="list"
            aria-label={t("team.members")}
          >
            {members.map((member) => (
              <article
                className="preference-row"
                key={member.userId}
                role="listitem"
              >
                <div>
                  <strong>{member.userId}</strong>
                  <p className="editor-meta">{member.role}</p>
                </div>
                {isAdminOrOwner && member.role !== "owner" ? (
                  <button
                    className="ghost-button"
                    onClick={() => onRemoveMember(member.userId)}
                    type="button"
                    aria-label={`${t("team.removeMember")} ${member.userId}`}
                  >
                    {t("team.removeMember")}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </>
      ) : null}

      {activeTab === "dictionary" ? (
        <>
          <div style={{ marginBottom: "0.75rem" }}>
            <button
              className="primary-button compact"
              onClick={onSyncDictionary}
              type="button"
            >
              {t("team.syncDictionary")}
            </button>
          </div>
          <div
            className="preference-list"
            role="list"
            aria-label={t("team.shared")}
          >
            {mergedDictionary.length === 0 ? (
              <p className="editor-meta">{t("team.emptyDictionary")}</p>
            ) : null}
            {mergedDictionary.map((entry) => (
              <article
                className="preference-row"
                key={entry.id}
                role="listitem"
              >
                <div>
                  <strong>{entry.spoken}</strong>
                  <p>{entry.replacement}</p>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}

      {activeTab === "snippets" ? (
        <>
          <div style={{ marginBottom: "0.75rem" }}>
            <button
              className="primary-button compact"
              onClick={onSyncSnippets}
              type="button"
            >
              {t("team.syncSnippets")}
            </button>
          </div>
          <div
            className="preference-list"
            role="list"
            aria-label={t("team.shared")}
          >
            {mergedSnippets.length === 0 ? (
              <p className="editor-meta">{t("team.emptySnippets")}</p>
            ) : null}
            {mergedSnippets.map((snippet) => (
              <article
                className="preference-row"
                key={snippet.id}
                role="listitem"
              >
                <div>
                  <strong>{snippet.trigger}</strong>
                  <p
                    className="editor-meta"
                    style={{
                      maxWidth: "24ch",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {snippet.body}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

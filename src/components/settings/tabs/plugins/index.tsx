import "./styles.css";

import * as DataStore from "@api/DataStore";
import { isPluginEnabled } from "@api/PluginManager";
import { useSettings } from "@api/Settings";
import { Card } from "@components/Card";
import { Divider } from "@components/Divider";
import ErrorBoundary from "@components/ErrorBoundary";
import { HeadingTertiary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings/tabs/BaseTab";
import { ChangeList } from "@utils/ChangeList";
import { classNameFactory } from "@utils/css";
import { isTruthy } from "@utils/guards";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { useAwaiter, useCleanupEffect } from "@utils/react";
import { PluginTag, PluginTags } from "@utils/types";
import { Button, ConfirmModal, lodash, openModal, Parser, React, SearchableSelect, Select, TextInput, Tooltip, useMemo, useRef, useState } from "@webpack/common";
import { JSX } from "react";

import Plugins, { ExcludedPlugins, PluginMeta } from "~plugins";
import { PluginCard } from "./PluginCard";
import { UIElementsButton } from "./UIElements";

export const cl = classNameFactory("vc-plugins-");
export const logger = new Logger("PluginSettings", "#a6d189");

function ReloadRequiredCard({ required, count, nikcordCount }: { required: boolean; count: number; nikcordCount: number; }) {
    return (
        <Card variant={required ? "warning" : "normal"} className={cl("info-card")}>
            {required
                ? <>
                    <HeadingTertiary>Restart required!</HeadingTertiary>
                    <Paragraph className={cl("dep-text")}>
                        Restart now to apply new plugins and their settings
                    </Paragraph>
                    <Button onClick={() => location.reload()} className={cl("restart-button")}>
                        Restart
                    </Button>
                </>
                : <>
                    <HeadingTertiary>Plugin Management</HeadingTertiary>
                    <Paragraph>Press the cog wheel or info icon to get more info on a plugin</Paragraph>
                    <Paragraph>Plugins with a cog wheel have settings you can modify!</Paragraph>
                    <Paragraph style={{ marginTop: "8px", opacity: 0.6, fontSize: "13px" }}>
                        {count} plugins installed &bull; {nikcordCount} Nikcord plugins
                    </Paragraph>
                </>
            }
        </Card>
    );
}

const enum SearchStatus {
    ALL,
    ENABLED,
    DISABLED,
    NEW,
    USER_PLUGINS,
    API_PLUGINS,
    NIKCORD_PLUGINS
}

function ExcludedPluginsList({ search }: { search: string; }) {
    const matchingExcludedPlugins = search
        ? Object.entries(ExcludedPlugins).filter(([name]) => name.toLowerCase().includes(search))
        : [];

    const ExcludedReasons: Record<string, string> = {
        desktop: "Discord Desktop app or Vesktop",
        discordDesktop: "Discord Desktop app",
        vesktop: "Vesktop app",
        web: "Vesktop app and the Web version of Discord",
        dev: "Developer version of Vencord"
    };

    return (
        <Paragraph className={Margins.top16}>
            {matchingExcludedPlugins.length ? (
                <>
                    <Paragraph>Are you looking for:</Paragraph>
                    <ul>
                        {matchingExcludedPlugins.map(([name, reason]) => (
                            <li key={name}>
                                <b>{name}</b>: Only available on the {ExcludedReasons[reason]}
                            </li>
                        ))}
                    </ul>
                </>
            ) : (
                "No plugins meet the search criteria."
            )}
        </Paragraph>
    );
}

function PluginSettings() {
    const settings = useSettings();
    const changeRef = useRef<ChangeList<string>>(null);
    const changes = changeRef.current ??= new ChangeList<string>();

    useCleanupEffect(() => {
        if (changes.hasChanges)
            openModal(props => (
                <ConfirmModal
                    {...props}
                    title="Restart required"
                    confirmText="Restart now"
                    cancelText="Later!"
                    variant="primary"
                    onConfirm={() => location.reload()}
                >
                    <>
                        <p>The following plugins require a restart:</p>
                        <div>{changes.map((s, i) => (
                            <>
                                {i > 0 && ", "}
                                {Parser.parse("`" + s.split(".")[0] + "`")}
                            </>
                        ))}</div>
                    </>
                </ConfirmModal>
            ));
    }, []);

    const depMap = useMemo(() => {
        const o: Record<string, string[]> = {};
        for (const plugin in Plugins) {
            const deps = Plugins[plugin].dependencies;
            if (deps) {
                for (const dep of deps) {
                    o[dep] ??= [];
                    o[dep].push(plugin);
                }
            }
        }
        return o;
    }, []);

    const sortedPlugins = useMemo(
        () => Object.values(Plugins).sort((a, b) => a.name.localeCompare(b.name)),
        []
    );

    const hasUserPlugins = useMemo(
        () => !IS_STANDALONE && Object.values(PluginMeta).some(m => m.userPlugin),
        []
    );

    const nikcordCount = useMemo(
        () => Object.values(Plugins).filter(p =>
            p.tags?.includes("Nikcord") ||
            (PluginMeta as any)?.[p.name]?.nikcord === true ||
            p.name.toLowerCase().includes("nikcord")
        ).length,
        []
    );

    const [searchValue, setSearchValue] = useState({
        value: "",
        tags: [] as PluginTag[],
        status: SearchStatus.ALL
    });

    const search = searchValue.value.toLowerCase();

    const pluginFilter = (plugin: typeof Plugins[keyof typeof Plugins]) => {
        const { status, tags } = searchValue;

        switch (status) {
            case SearchStatus.DISABLED:
                if (isPluginEnabled(plugin.name)) return false;
                break;
            case SearchStatus.ENABLED:
                if (!isPluginEnabled(plugin.name)) return false;
                break;
            case SearchStatus.NEW:
                if (!newPlugins?.includes(plugin.name)) return false;
                break;
            case SearchStatus.USER_PLUGINS:
                if (!PluginMeta[plugin.name]?.userPlugin) return false;
                break;
            case SearchStatus.API_PLUGINS:
                if (!plugin.name.endsWith("API")) return false;
                break;
            case SearchStatus.NIKCORD_PLUGINS:
                const isNikcord =
                    plugin.tags?.includes("Nikcord") ||
                    (PluginMeta as any)?.[plugin.name]?.nikcord === true ||
                    plugin.name.toLowerCase().includes("nikcord");
                if (!isNikcord) return false;
                break;
        }

        if (tags.length && tags.some(t => !plugin.tags?.includes(t))) return false;

        if (!search.length) return true;

        return (
            plugin.name.toLowerCase().includes(search) ||
            plugin.name.match(/[A-Z]/g)?.join("").toLowerCase().includes(search) ||
            plugin.description.toLowerCase().includes(search) ||
            plugin.searchTerms?.some(t => t.toLowerCase().includes(search))
        );
    };

    const [newPlugins] = useAwaiter(() =>
        DataStore.get("Vencord_existingPlugins").then((cached: Record<string, number> | undefined) => {
            const now = Date.now() / 1000;
            const existing: Record<string, number> = {};
            const sortedNames = Object.values(sortedPlugins).map(p => p.name);
            const newPlugins: string[] = [];

            for (const { name: p } of sortedPlugins) {
                const time = existing[p] = cached?.[p] ?? now;
                if ((time + 60 * 60 * 24 * 2) > now) newPlugins.push(p);
            }

            DataStore.set("Vencord_existingPlugins", existing);
            return lodash.isEqual(newPlugins, sortedNames) ? [] : newPlugins;
        })
    );

    const plugins: JSX.Element[] = [];
    const requiredPlugins: JSX.Element[] = [];

    const showApi = searchValue.status === SearchStatus.API_PLUGINS;

    for (const p of sortedPlugins) {
        if (p.hidden || (!p.settings && p.name.endsWith("API") && !showApi)) continue;
        if (!pluginFilter(p)) continue;

        const isRequired =
            p.required ||
            p.isDependency ||
            depMap[p.name]?.some(d => settings.plugins[d].enabled);

        if (isRequired) {
            requiredPlugins.push(
                <Tooltip text="Required plugin" key={p.name}>
                    {({ onMouseEnter, onMouseLeave }) => (
                        <PluginCard
                            plugin={p}
                            disabled
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                            onRestartNeeded={(name, key) => changes.handleChange(`${name}.${key}`)}
                        />
                    )}
                </Tooltip>
            );
        } else {
            plugins.push(
                <PluginCard
                    key={p.name}
                    plugin={p}
                    disabled={false}
                    isNew={newPlugins?.includes(p.name)}
                    onRestartNeeded={(name, key) => changes.handleChange(`${name}.${key}`)}
                />
            );
        }
    }

    return (
        <SettingsTab>
            <ReloadRequiredCard required={changes.hasChanges} count={Object.values(Plugins).length} nikcordCount={nikcordCount} />

            <UIElementsButton />

            <HeadingTertiary className={classes(Margins.top20, Margins.bottom8)}>
                Filters
            </HeadingTertiary>

            <TextInput
                inputClassName={cl("filter-control")}
                placeholder="Search for a plugin..."
                value={searchValue.value}
                onChange={v => setSearchValue(p => ({ ...p, value: v }))}
                autoFocus
            />

            <div className={classes(Margins.bottom20, Margins.top8, cl("filter-controls"))}>
                <Select
                    options={[
                        { label: "Show All", value: SearchStatus.ALL, default: true },
                        { label: "Show Enabled", value: SearchStatus.ENABLED },
                        { label: "Show Disabled", value: SearchStatus.DISABLED },
                        { label: "Show New", value: SearchStatus.NEW },
                        hasUserPlugins && { label: "Show UserPlugins", value: SearchStatus.USER_PLUGINS },
                        { label: "Show API Plugins", value: SearchStatus.API_PLUGINS },
                        { label: "Show Nikcord plugins (Extra)", value: SearchStatus.NIKCORD_PLUGINS }
                    ].filter(isTruthy)}
                    serialize={String}
                    select={v => setSearchValue(p => ({ ...p, status: v }))}
                    isSelected={v => v === searchValue.status}
                    closeOnSelect
                />

                <SearchableSelect
                    options={PluginTags.map(tag => ({ label: tag, value: tag }))}
                    value={searchValue.tags}
                    onChange={tags => setSearchValue(p => ({ ...p, tags }))}
                    closeOnSelect={false}
                    multi
                />
            </div>

            <HeadingTertiary>Plugins</HeadingTertiary>

            <div className={cl("grid")}>
                {plugins.length
                    ? plugins
                    : <Paragraph>No plugins meet the search criteria.</Paragraph>
                }
            </div>

            <Divider className={Margins.top20} />

            <HeadingTertiary>Required Plugins</HeadingTertiary>

            <div className={cl("grid")}>
                {requiredPlugins.length
                    ? requiredPlugins
                    : <Paragraph>No plugins meet the search criteria.</Paragraph>
                }
            </div>
        </SettingsTab>
    );
}

export default wrapTab(PluginSettings, "Plugins");

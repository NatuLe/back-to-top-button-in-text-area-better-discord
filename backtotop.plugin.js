/**
 * @name BackToTopButton
 * @description This plugin adds a button to the Discord textarea that, when clicked, navigates to the top of the current path based on invisible typing and jumptotop plugins.
 * @author Natsuki Yūko
 */

const { React, DOM, Patcher, UI, Utils, ReactUtils, Webpack: _Webpack } = new BdApi("InvisibleTyping");

const Webpack = {
    ..._Webpack,
    getByProps(...props) { return this.getModule(this.Filters.byProps(...props)); },
    getStore(name) { return this.getModule(m => m?._dispatchToken && m?.getName() === name); },
    getBulk(...queries) { return _Webpack.getBulk(...queries.map(q => typeof q === "function" ? { filter: q } : q)); },
    getByKeys(...keys) { return this.getModule(this.Filters.byKeys(...keys)); }
};

const transitionTo = Webpack.getByKeys("transitionTo")?.transitionTo;

class BackToTopButton extends React.Component {
    constructor(props) {
        super(props);
        this.handleClick = this.handleClick.bind(this);
        this.state = {
            constantPath: this.getConstantPath(props.uniqueId)
        };
    }

    getConstantPath(uniqueId) {
        let currentPath = location.pathname;
        const threadPattern = /\/channels\/(\d+)\/(\d+)\/threads\/(\d+)/;

        if (threadPattern.test(currentPath)) {
            currentPath = currentPath.replace(threadPattern, "/channels/$1/$3");
        }

        if (!currentPath.endsWith("/0")) {
            currentPath += "/0";
        }

        return `${currentPath}?id=${uniqueId}`;
    }

    handleClick() {
        transitionTo(this.state.constantPath);
    }

    render() {
        return React.createElement(
            "button",
            {
                className: "back-to-top-button",
                onClick: this.handleClick
            },
            "🡹"
        );
    }
}

async function patchTextAreaButtons(meta) {
    const buttonsClassName = Webpack.getByProps("profileBioInput", "buttons")?.buttons;

    if (!buttonsClassName) return UI.showToast(`[${meta.name}] Could not add button to textarea.`, { type: "error" });

    const controller = new AbortController();
    const instance = await new Promise((resolve, reject) => {
        onceAdded("." + buttonsClassName, e => {
            const vnode = ReactUtils.getInternalInstance(e);

            if (!vnode) return;

            for (let curr = vnode, max = 100; curr !== null && max--; curr = curr.return) {
                const tree = curr?.pendingProps?.children;
                let buttons;
                if (Array.isArray(tree) && (buttons = tree.find(s => s?.props?.type && s.props.channel && s.type?.$$typeof))) {
                    resolve(buttons.type);
                    break;
                }
            }
        }, controller.signal);

        const abort = controller.abort.bind(controller);

        controller.signal.addEventListener("abort", () => {
            cleanup.delete(abort);
            reject();
        });

        cleanup.add(abort);
    });

    Patcher.after(instance, "type", (_, [props], res) => {
        const uniqueId = `${props.channel?.id || 'default'}-${Date.now()}`;
        const existingButton = res.props.children.find(child => child && child.type && child.type.name === "BackToTopButton");
        
        if (!existingButton) {
            res.props.children.unshift(React.createElement(BackToTopButton, { ...props, uniqueId }));
        }
    });
}

function setupButtonPatch(meta) {
    // Initial patch
    patchTextAreaButtons(meta).catch(() => {});

    // Setup a MutationObserver to re-apply the patch if necessary
    const observer = new MutationObserver(() => {
        patchTextAreaButtons(meta).catch(() => {});
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

module.exports = class InvisibleTyping {
    constructor(metaObject) {
        this.meta = metaObject;
        this.cleanup = new Set([
            () => Patcher.unpatchAll(),
            () => DOM.removeStyle(),
            () => new Set(document.getElementsByClassName("back-to-top-button")).forEach(el => el.unmount?.())
        ]);
    }

    start() {
        DOM.addStyle(`
            .back-to-top-button {
                margin-top: 3px;
                background-color: transparent;
                color: var(--text-normal);
                border: none;
                border-radius: 5px;
                padding: 5px 4px;
                cursor: pointer;
                z-index: 1000;
                margin: 0 4px;
                font-size: 20px;
            }

            .back-to-top-button:hover {
                background-color: transparent;
                transform: scale(1.1);
            }
        `);

        BackToTopButton.defaultProps ??= {};

        [
            BackToTopButton.defaultProps.PermissionUtils,
            BackToTopButton.defaultProps.UserStore,
            BackToTopButton.defaultProps.Tooltip
        ] = Webpack.getBulk(
            { searchExports: true, filter: Webpack.Filters.byProps("can", "areChannelsLocked") },
            m => m?._dispatchToken && m.getName() === "UserStore",
            { searchExports: true, filter: Webpack.Filters.byPrototypeFields("renderTooltip") }
        );

        setupButtonPatch(this.meta);
    }

    stop() {
        this.cleanup.forEach(clean => clean());
    }

   
};

// Helper function
function onceAdded(selector, callback, signal) {
    let directMatch;
    if (directMatch = document.querySelector(selector)) {
        callback(directMatch);
        return () => null;
    }

    const cancel = () => observer.disconnect();

    const observer = new MutationObserver(changes => {
        for (const change of changes) {
            if (!change.addedNodes.length) continue;

            for (const node of change.addedNodes) {
                const match = (node.matches(selector) && node) || node.querySelector(selector);

                if (!match) continue;

                cancel();
                signal.removeEventListener("abort", cancel);

                callback(match);
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    signal.addEventListener("abort", cancel);
}


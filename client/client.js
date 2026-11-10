// Browser half of dsh-lan-models: the "局域网模型" settings page.
//
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load
// with a factory returning cordis-plugin exports), so this page needs no build
// step and imports nothing from dsh client packages except react. It reads and
// writes the plugin's own loopback routes (/lan-models/*), which is where the
// model mounting actually happens.
window.__ModuleLoader__.load({
  id: 'dsh-lan-models',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var TEXT = {
      zh: {
        title: '局域网模型',
        subtitle: '把局域网里的 OpenAI 兼容服务装载成 dsh 可选模型，装载后在模型选择器里直接切换。',
        refresh: '重新扫描',
        scanning: '扫描中…',
        loading: '加载中…',
        empty: '没有发现可用的模型服务。确认服务已启动并监听 0.0.0.0，或在插件配置里补 staticHosts。',
        services: '发现的服务',
        mounted: '已装载',
        mountedTag: '已装载',
        noneMounted: '还没有装载任何模型。',
        load: '装载',
        loading2: '装载中…',
        unload: '卸载',
        unmounting: '卸载中…',
        models: '个模型',
        noModels: '无模型清单',
        notChat: '非对话服务',
        truncated: '扫描被时限截断，结果可能不完整（调大 scanDeadlineSeconds 后重扫）。',
        failed: '操作失败',
        manual: '手动装载地址',
        manualPlaceholder: 'http://127.0.0.1:18000（仅监听回环的服务可用 SSH 隧道转发到本机）',
        apiKeyPlaceholder: 'API Key（可选；oMLX 绑 0.0.0.0 时必填）',
        manualHint: '扫描发现不了 127.0.0.1 上的服务：先 ssh -L 18000:127.0.0.1:8000 <mac> 建隧道，再把 http://127.0.0.1:18000 填进来。绑 0.0.0.0 的服务要在下面填 API Key。',
        hint: '装载会写入 llm-pi-ai 的 provider 配置；卸载只删除本插件装载的 lan-* 路由。',
      },
      en: {
        title: 'LAN models',
        subtitle: 'Mount OpenAI-compatible services on the LAN as dsh models, then pick them in the model selector.',
        refresh: 'Rescan',
        scanning: 'scanning…',
        loading: 'loading…',
        empty: 'No model service found. Start one listening on 0.0.0.0, or add staticHosts to the plugin config.',
        services: 'Discovered services',
        mounted: 'Mounted',
        mountedTag: 'mounted',
        noneMounted: 'Nothing mounted yet.',
        load: 'Mount',
        loading2: 'mounting…',
        unload: 'Unmount',
        unmounting: 'unmounting…',
        models: 'models',
        noModels: 'no model list',
        notChat: 'not a chat service',
        truncated: 'Scan hit its deadline; results may be incomplete (raise scanDeadlineSeconds and rescan).',
        failed: 'failed',
        hint: 'Mounting writes an llm-pi-ai provider; unmounting only removes lan-* routes owned by this plugin.',
      },
    };

    function labels() {
      // This plugin ships Chinese copy only for now: the panel is a personal
      // LAN tool, and a half-translated page reads worse than one language.
      return TEXT.zh;
    }

    function Page(react, t) {
      var h = react.createElement;
      var useState = react.useState;
      var useEffect = react.useEffect;
      var useCallback = react.useCallback;

      function note(error) {
        return error && error.message ? error.message : String(error || '');
      }

      var mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' };
      var dim = { color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))', fontSize: '13px' };
      var row = {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 12px',
        borderTop: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.18))',
      };
      var btn = {
        border: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.3))',
        background: 'transparent',
        color: 'inherit',
        borderRadius: '6px',
        padding: '3px 10px',
        fontSize: '12px',
        cursor: 'pointer',
      };
      var btnPrimary = Object.assign({}, btn, {
        borderColor: 'var(--dsw-alias-brand, #4d6bfe)',
        color: 'var(--dsw-alias-brand, #4d6bfe)',
      });

      function fetchJson(url, init) {
        return fetch(url, init).then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok) throw new Error(body && body.error ? body.error : 'HTTP ' + res.status);
            return body;
          });
        });
      }

      return function LanModelsPage() {
        var state = useState({ loading: true, error: null, data: null });
        var s = state[0];
        var set = state[1];
        var busy = useState('');
        var busyId = busy[0];
        var setBusy = busy[1];
        var manual = useState('');
        var manualUrl = manual[0];
        var setManualUrl = manual[1];
        var keyState = useState('');
        var apiKey = keyState[0];
        var setApiKey = keyState[1];

        var load = useCallback(function () {
          set({ loading: true, error: null, data: s.data });
          return fetchJson('/lan-models/state')
            .then(function (data) {
              set({ loading: false, error: null, data: data });
            })
            .catch(function (error) {
              set({ loading: false, error: note(error), data: null });
            });
        }, []);

        useEffect(function () {
          load();
        }, []);

        var act = function (url, payload, id) {
          setBusy(id);
          fetchJson(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
            .then(function () {
              return load();
            })
            .catch(function (error) {
              set({ loading: false, error: note(error), data: s.data });
            })
            .then(function () {
              setBusy('');
            });
        };

        var data = s.data || {};
        var mounted = data.mounted || [];
        var services = data.services || [];

        var header = h(
          'div',
          { style: { display: 'flex', alignItems: 'flex-start', gap: '12px' } },
          h(
            'div',
            { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontSize: '15px', fontWeight: 600 } }, t.title),
            h('div', { style: Object.assign({}, dim, { lineHeight: 1.5, marginTop: '2px' }) }, t.subtitle),
          ),
          h(
            'button',
            { style: btn, disabled: s.loading || busyId !== '', onClick: load },
            s.loading ? t.scanning : t.refresh,
          ),
        );

        var errorLine = s.error
          ? h('div', { style: { color: '#d4534b', fontSize: '13px', padding: '8px 0' } }, t.failed + ': ' + s.error)
          : null;

        var truncated = data.truncated
          ? h('div', { style: { color: '#b7791f', fontSize: '12px', padding: '4px 0' } }, t.truncated)
          : null;

        var serviceRows = services.map(function (svc) {
          var isChat = svc.kind === 'openai';
          var mountedThis = mounted.some(function (m) {
            return m.baseURL && m.baseURL.indexOf(svc.key) === 0;
          });
          return h(
            'div',
            { key: svc.key, style: row },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: '13px', fontWeight: 600 } }, svc.key),
              h(
                'div',
                { style: Object.assign({}, mono, { color: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))' }) },
                (svc.software || svc.kind) + ' · ' + (svc.models.length ? svc.models.length + ' ' + t.models : t.noModels),
              ),
              svc.models.length
                ? h(
                    'div',
                    { style: Object.assign({}, mono, { marginTop: '2px', wordBreak: 'break-all' }) },
                    svc.models.slice(0, 4).join(', ') + (svc.models.length > 4 ? ', …' : ''),
                  )
                : null,
            ),
            isChat
              ? mountedThis
                ? h('span', { style: Object.assign({}, dim, { fontSize: '12px' }) }, t.mountedTag)
                : h(
                    'button',
                    {
                      style: btnPrimary,
                      disabled: busyId !== '',
                      onClick: function () {
                        act('/lan-models/mount', { key: svc.key }, svc.key);
                      },
                    },
                    busyId === svc.key ? t.loading2 : t.load,
                  )
              : h('span', { style: dim }, t.notChat),
          );
        });

        var mountedRows = mounted.map(function (m) {
          return h(
            'div',
            { key: m.providerId, style: row },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: '13px', fontWeight: 600 } }, m.displayName || m.providerId),
              h('div', { style: mono }, m.providerId + ' · ' + m.modelCount + ' ' + t.models),
            ),
            h(
              'button',
              {
                style: btn,
                disabled: busyId !== '',
                onClick: function () {
                  act('/lan-models/unmount', { providerId: m.providerId }, m.providerId);
                },
              },
              busyId === m.providerId ? t.unmounting : t.unload,
            ),
          );
        });

        return h(
          'div',
          { style: { padding: '16px 20px', fontSize: '14px' } },
          header,
          errorLine,
          truncated,
          h('div', { style: { marginTop: '16px', fontWeight: 600, fontSize: '13px' } }, t.manual),
          h(
            'div',
            { style: { display: 'flex', gap: '8px', marginTop: '6px' } },
            h('input', {
              value: manualUrl,
              placeholder: t.manualPlaceholder,
              onChange: function (event) {
                setManualUrl(event.target.value);
              },
              style: {
                flex: 1,
                minWidth: 0,
                padding: '5px 8px',
                borderRadius: '6px',
                border: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.3))',
                background: 'transparent',
                color: 'inherit',
                fontSize: '12px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              },
            }),
            h('input', {
              value: apiKey,
              type: 'password',
              placeholder: t.apiKeyPlaceholder,
              onChange: function (event) {
                setApiKey(event.target.value);
              },
              style: {
                width: '230px',
                padding: '5px 8px',
                borderRadius: '6px',
                border: '1px solid var(--dsw-alias-border, rgba(127,127,127,0.3))',
                background: 'transparent',
                color: 'inherit',
                fontSize: '12px',
              },
            }),
            h(
              'button',
              {
                style: btnPrimary,
                disabled: busyId !== '' || String(manualUrl).trim() === '',
                onClick: function () {
                  act(
                    '/lan-models/mount',
                    { key: String(manualUrl).trim(), apiKey: String(apiKey).trim() || undefined },
                    'manual',
                  );
                },
              },
              busyId === 'manual' ? t.loading2 : t.load,
            ),
          ),
          h('div', { style: Object.assign({}, dim, { marginTop: '6px', fontSize: '12px' }) }, t.manualHint),
          h('div', { style: { marginTop: '18px', fontWeight: 600, fontSize: '13px' } }, t.services),
          s.loading && !s.data ? h('div', { style: dim }, t.loading) : null,
          !s.loading && !s.error && services.length === 0 ? h('div', { style: dim }, t.empty) : null,
          h('div', { style: { marginTop: '4px' } }, serviceRows),
          h('div', { style: { marginTop: '22px', fontWeight: 600, fontSize: '13px' } }, t.mounted),
          mountedRows.length === 0 ? h('div', { style: dim }, t.noneMounted) : h('div', null, mountedRows),
          h('div', { style: Object.assign({}, dim, { marginTop: '18px', fontSize: '12px' }) }, t.hint),
        );
      };
    }

    function apply(ctx) {
      if (typeof ctx.inject !== 'function') return;
      ctx.inject(['slots'], function (scope) {
        try {
          var react = require('react');
          var t = labels();
          var Component = Page(react, t);
          scope.slots.inject('settings.section', function* () {
            yield scope.slots.register(
              { name: 'settings.section', id: 'lan-models', order: 55, label: t.title },
              Component,
            );
          });
        } catch (error) {
          console.error('[lan-models] settings page skipped: ' + error);
        }
      });
    }

    exports.apply = apply;
    exports.inject = [];
    return module.exports;
  },
});

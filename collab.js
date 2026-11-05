/*
 * MURAL - El Bote de los 100 Kilos
 * Colaboración y persistencia con Supabase
 */

(() => {
  "use strict";

  const TABLES = ["mesa1", "mesa2", "mesa3", "mesa4"];
  const SYNC_INTERVAL = 2500;

  let db = null;
  let sessionCode = null;
  let role = null;
  let connected = false;
  let syncing = false;
  let lastSnapshot = "";
  let lastError = "";

  const originalMove = window.moveItem;
  const originalClear = window.clearBoat;
  const originalCrisis = window.applyCrisisToAllTeams;

  function message(text) {
    const status = document.getElementById("collab-status");
    if (status) status.textContent = text;
  }

  function errorText(error) {
    return error?.message || String(error);
  }

  async function rpc(name, params = {}) {
    const { data, error } = await db.rpc(name, params);
    if (error) throw error;
    return data;
  }

  async function initialize() {
    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_KEY;

    if (!url || !key || key.includes("PEGA_AQUI")) {
      alert("Falta configurar Supabase en config.js");
      return;
    }

    if (!window.supabase?.createClient) {
      alert("No se cargó la biblioteca de Supabase");
      return;
    }

    db = window.supabase.createClient(url, key);

    const { data, error } = await db.auth.getSession();
    if (error) throw error;

    if (!data.session) {
      const result = await db.auth.signInAnonymously();
      if (result.error) throw result.error;
    }

    showAccessPanel();
  }

  function showAccessPanel() {
    if (document.getElementById("collab-panel")) return;

    const panel = document.createElement("div");
    panel.id = "collab-panel";
    panel.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:rgba(5,10,25,.96);
      display:flex;align-items:center;
      justify-content:center;padding:20px;
      font-family:Arial,sans-serif;color:white;
    `;

    panel.innerHTML = `
      <div style="background:#1e293b;padding:28px;
        border-radius:16px;width:100%;max-width:440px">
        <h2 style="font-size:22px;font-weight:bold">
          El Bote de los 100 Kilos
        </h2>
        <p style="margin:12px 0;color:#cbd5e1">
          Seleccioná cómo querés participar.
        </p>

        <label>Nombre del taller</label>
        <input id="collab-title" value="Taller de Demanda"
          style="width:100%;padding:10px;color:#111;
          margin:8px 0;border-radius:6px">

        <button id="collab-create"
          style="background:#2563eb;padding:12px;
          width:100%;border-radius:8px;margin:8px 0">
          Crear sesión como facilitador
        </button>

        <hr style="margin:18px 0;border-color:#475569">

        <label>Código de sesión</label>
        <input id="collab-code" placeholder="Código del taller"
          style="width:100%;padding:10px;color:#111;
          margin:8px 0;border-radius:6px">

        <label>Mi mesa</label>
        <select id="collab-team"
          style="width:100%;padding:10px;color:#111;
          margin:8px 0;border-radius:6px">
          <option value="mesa1">Mesa 1</option>
          <option value="mesa2">Mesa 2</option>
          <option value="mesa3">Mesa 3</option>
          <option value="mesa4">Mesa 4</option>
        </select>

        <button id="collab-join"
          style="background:#059669;padding:12px;
          width:100%;border-radius:8px;margin-top:10px">
          Ingresar al taller
        </button>

        <p id="collab-status"
          style="margin-top:14px;color:#fbbf24"></p>
      </div>
    `;

    document.body.appendChild(panel);

    document.getElementById("collab-create").onclick =
      createSession;
    document.getElementById("collab-join").onclick =
      joinSession;
  }

  async function createSession() {
    try {
      message("Creando sesión...");
      const title =
        document.getElementById("collab-title").value;

      const code = await rpc("mural_create", {
        p_title: title
      });

      sessionCode = code;
      role = "facilitador";
      await startSession();

      alert("Sesión creada. Código: " + code);
    } catch (error) {
      message(errorText(error));
    }
  }

  async function joinSession() {
    try {
      message("Ingresando...");
      const code = document.getElementById("collab-code")
        .value.trim().toUpperCase();

      const team = document.getElementById("collab-team")
        .value;

      const result = await rpc("mural_join", {
        p_code: code,
        p_team: team
      });

      sessionCode = code;
      role = result.role;
      await startSession();
    } catch (error) {
      message(errorText(error));
    }
  }

  async function startSession() {
    connected = true;

    try {
      await sync();
    } catch (error) {
      connected = false;
      throw error;
    }

    document.getElementById("collab-panel").remove();

    const label = document.createElement("div");
    label.id = "collab-session-label";
    label.style.cssText = `
      position:fixed;bottom:12px;right:12px;
      background:#0f172a;color:white;
      padding:10px 14px;border:1px solid #475569;
      border-radius:8px;z-index:100;
      font:12px Arial,sans-serif;
    `;

    label.textContent =
      "Sesión: " + sessionCode + " | " + role;

    document.body.appendChild(label);

    if (role !== "facilitador") {
      window.switchTeam(role);
      document.querySelectorAll(".team-tab")
        .forEach(button => {
          button.style.display =
            button.id === "tab-" + role ? "" : "none";
        });

      const crisisButton =
        document.querySelector(
          'button[onclick="triggerCrisisModal()"]'
        );
      if (crisisButton) crisisButton.style.display = "none";
    }

    setInterval(() => {
      if (connected) sync().catch(console.error);
    }, SYNC_INTERVAL);
  }

  async function sync() {
    if (!connected || syncing) return;
    syncing = true;

    try {
      const snapshot = await rpc("mural_snapshot", {
        p_code: sessionCode
      });

      if (!snapshot) return;

      const fingerprint = JSON.stringify({
        choices: snapshot.choices,
        crisis: snapshot.crisis
      });

      if (fingerprint === lastSnapshot) return;
      lastSnapshot = fingerprint;

      for (const teamId of TABLES) {
        if (role !== "facilitador" && role !== teamId) {
          continue;
        }

        const team = window.teamsState[teamId];
        if (!team) continue;

        const allItems = [
          ...window.BASE_ITEMS,
          ...(snapshot.crisis ? [window.CRISIS_ITEM] : [])
        ];

        const decisions = (snapshot.choices || [])
          .filter(choice => choice.team === teamId);

        const inBoat = new Set(
          decisions
            .filter(choice => choice.zone === "boat")
            .map(choice => choice.item_id)
        );

        team.boat = allItems
          .filter(item => inBoat.has(item.id))
          .map(item => ({ ...item }));

        team.beach = allItems
          .filter(item => !inBoat.has(item.id))
          .map(item => ({ ...item }));
      }

      window.renderCurrentTeam();

    } finally {
      syncing = false;
    }
  }

  window.moveItem = async function(itemId, targetZone) {
    if (!connected) return;

    const team = window.currentTeam;

    if (role !== "facilitador" && role !== team) return;

    try {
      await rpc("mural_move", {
        p_code: sessionCode,
        p_team: team,
        p_item_id: itemId,
        p_zone: targetZone
      });

      lastSnapshot = "";
      await sync();
    } catch (error) {
      alert("No se pudo guardar: " + errorText(error));
    }
  };

  window.clearBoat = async function() {
    if (!connected) return;

    try {
      await rpc("mural_clear", {
        p_code: sessionCode,
        p_team: window.currentTeam
      });

      lastSnapshot = "";
      await sync();
    } catch (error) {
      alert(errorText(error));
    }
  };

  window.applyCrisisToAllTeams = async function() {
    if (!connected || role !== "facilitador") return;

    try {
      await rpc("mural_crisis", {
        p_code: sessionCode
      });

      window.closeCrisisModal();
      lastSnapshot = "";
      await sync();
    } catch (error) {
      alert(errorText(error));
    }
  };

  window.addEventListener("load", () => {
    initialize().catch(error => {
      alert("Error de conexión: " + errorText(error));
    });
  });

})();

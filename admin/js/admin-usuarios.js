// admin-usuarios.js - Gestión de usuarios (cajeros y admins)
(function() {
    let currentUserFotoFile = null;
    let currentUserFotoUrl  = '';
    
    window.toggleExpandirImagenUsuario = function() {
        const previewImg = document.getElementById('usuarioPreviewImg');
        if (previewImg && previewImg.src) {
            window.expandirImagen(previewImg.src);
        }
    };

    window.cargarUsuarios = async function() {
        try {
            const { data, error } = await window.supabaseClient.from('usuarios').select('*').order('nombre');
            if (error) throw error;
            window.usuarios = data || [];
            window.renderizarUsuarios();
        } catch (e) { console.error('Error cargando usuarios:', e); window.mostrarToast('Error cargando usuarios', 'error'); }
    };

    window.renderizarUsuarios = function() {
        const grid = document.getElementById('usuariosGrid');
        if (!window.usuarios || !window.usuarios.length) {
            grid.innerHTML = '<p style="color:var(--text-muted);font-size:.88rem">No hay cajeros registrados.</p>';
            return;
        }
        grid.innerHTML = window.usuarios.map(user => {
            const inicial     = (user.nombre||'?').charAt(0).toUpperCase();
            const rolBadge    = user.rol==='admin' ? '<span class="usuario-rol admin">Admin</span>' : '<span class="usuario-rol cajero">Cajero</span>';
            const statusBadge = user.activo
                ? '<span class="ucard-status-inline" style="color:var(--success)"><i class="fas fa-check-circle"></i> Activo</span>'
                : '<span class="ucard-status-inline" style="color:var(--text-muted)"><i class="fas fa-circle"></i> Inactivo</span>';
            const avatarInner = user.foto
                ? `<img src="${user.foto}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;display:block;cursor:pointer" onclick="window.expandirImagen&&window.expandirImagen(this.src)">`
                : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--primary),var(--primary-dark));border-radius:8px">${inicial}</div>`;
            return `<div class="usuario-card-v2 usuario-card">
                <div class="ucard-avatar">${avatarInner}</div>
                <div class="ucard-body">
                    <div class="ucard-top">
                        <div class="ucard-names">
                            <div class="ucard-line1"><span class="usuario-nombre">${user.nombre}</span>${statusBadge}</div>
                            <div class="ucard-line2"><span class="usuario-username">@${user.username}</span> ${rolBadge}</div>
                            <div class="ucard-line3">
                                <button class="btn-toggle ${user.activo ? 'btn-toggle-on' : 'btn-toggle-off'}"
                                    onclick="window.toggleUsuarioActivo('${user.id}', ${!user.activo})">
                                    ${user.activo ? 'Inhabilitar' : 'Activar'}
                                </button>
                                <div class="ucard-actions-right">
                                    <button class="btn-icon edit" onclick="window.editarUsuario('${user.id}')" title="Editar usuario"><i class="fas fa-pen"></i></button>
                                    <button class="btn-icon delete" onclick="window.eliminarUsuario('${user.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    };


    function handleUsuarioFotoFile() {
        var fi=document.getElementById('usuarioFoto');
        var ui=document.getElementById('usuarioFotoUrl');
        var pd=document.getElementById('usuarioFotoPreview');
        var pi=document.getElementById('usuarioPreviewImg');
        var rb=document.getElementById('usuarioFotoRemoveBtn');
        if (!fi||!pd) return;
        if (fi.files && fi.files[0]) {
            currentUserFotoFile=fi.files[0]; currentUserFotoUrl='';
            if(ui){ui.value='';ui.disabled=true;}
            var reader=new FileReader();
            reader.onload=function(e){if(pi)pi.src=e.target.result;pd.style.display='flex';if(rb)rb.style.display='flex';};
            reader.readAsDataURL(fi.files[0]);
        } else { if(ui)ui.disabled=false; }
    }
    function handleUsuarioFotoUrl() {
        var ui=document.getElementById('usuarioFotoUrl');
        var fi=document.getElementById('usuarioFoto');
        var pd=document.getElementById('usuarioFotoPreview');
        var pi=document.getElementById('usuarioPreviewImg');
        var rb=document.getElementById('usuarioFotoRemoveBtn');
        if(!ui||!pd) return;
        if(fi&&fi.files&&fi.files[0]) return;
        var url=ui.value.trim();
        if(url){currentUserFotoUrl=url;currentUserFotoFile=null;if(pi)pi.src=url;pd.style.display='flex';if(rb)rb.style.display='flex';}
        else{pd.style.display='none';if(rb)rb.style.display='none';if(pi)pi.src='';currentUserFotoUrl='';}
    }
    function removeUsuarioFoto() {
        var fi=document.getElementById('usuarioFoto');
        var ui=document.getElementById('usuarioFotoUrl');
        var pd=document.getElementById('usuarioFotoPreview');
        var pi=document.getElementById('usuarioPreviewImg');
        var rb=document.getElementById('usuarioFotoRemoveBtn');
        if(fi)fi.value=''; if(ui){ui.value='';ui.disabled=false;}
        if(pd)pd.style.display='none'; if(rb)rb.style.display='none';
        if(pi)pi.src=''; currentUserFotoFile=null; currentUserFotoUrl='';
    }

    window.toggleUsuarioActivo = async function(userId, activo) {
        const user = window.usuarios.find(u => u.id === userId);
        if (user && user.rol === 'admin') {
            const adminsActivos = window.usuarios.filter(u => u.rol === 'admin' && u.activo === true);
            if (adminsActivos.length === 1 && !activo) {
                window.mostrarToast('⚠️ No se puede desactivar el único administrador activo', 'warning');
                return;
            }
        }
        try {
            await window.supabaseClient.from('usuarios').update({ activo }).eq('id', userId);
            await window.cargarUsuarios();
            window.mostrarToast(`✅ Usuario ${activo ? 'activado' : 'desactivado'}`, 'success');
        } catch (e) { console.error('Error actualizando usuario:', e); window.mostrarToast('❌ Error al actualizar usuario', 'error'); }
    };

    window.abrirModalNuevoUsuario = function() {
        var form=document.getElementById('usuarioForm');
        if(form)form.reset();
        var rolSelect=document.getElementById('usuarioRol');
        if(rolSelect)rolSelect.value='cajero';
        var activoSelect=document.getElementById('usuarioActivo');
        if(activoSelect)activoSelect.value='true';
        currentUserFotoFile=null;
        currentUserFotoUrl='';
        var fotoInput=document.getElementById('usuarioFoto');
        if(fotoInput)fotoInput.value='';
        var urlInput=document.getElementById('usuarioFotoUrl');
        if(urlInput){urlInput.value='';urlInput.disabled=false;}
        var emailRecuperacionInput=document.getElementById('usuarioEmailRecuperacion');
        if(emailRecuperacionInput)emailRecuperacionInput.value='';
        var previewDiv=document.getElementById('usuarioFotoPreview');
        if(previewDiv)previewDiv.style.display='none';
        var modalTitle=document.getElementById('usuarioModalTitle');
        if(modalTitle)modalTitle.textContent='Nuevo Cajero/Admin';
        window.usuarioEditandoId=null;
        var modal=document.getElementById('usuarioModal');
        if(modal)modal.classList.add('active');
    };

    window.editarUsuario = function(id) {
        var user=window.usuarios.find(u=>u.id===id);
        if(!user)return;
        window.usuarioEditandoId=id;
        var modalTitle=document.getElementById('usuarioModalTitle');
        if(modalTitle)modalTitle.textContent='Editar Usuario';
        var nombreInput=document.getElementById('usuarioNombre');
        if(nombreInput)nombreInput.value=user.nombre||'';
        var usernameInput=document.getElementById('usuarioUsername');
        if(usernameInput)usernameInput.value=user.username||'';
        var emailRecuperacionInput=document.getElementById('usuarioEmailRecuperacion');
        if(emailRecuperacionInput)emailRecuperacionInput.value=user.email_recuperacion||'';
        var rolSelect=document.getElementById('usuarioRol');
        if(rolSelect)rolSelect.value=user.rol||'cajero';
        var activoSelect=document.getElementById('usuarioActivo');
        if(activoSelect)activoSelect.value=user.activo?'true':'false';
        var passwordInput=document.getElementById('usuarioPassword');
        if(passwordInput)passwordInput.value='';
        var urlInput=document.getElementById('usuarioFotoUrl');
        var previewImg=document.getElementById('usuarioPreviewImg');
        var previewDiv=document.getElementById('usuarioFotoPreview');
        var fotoInput=document.getElementById('usuarioFoto');
        if(user.foto){
            if(urlInput)urlInput.value=user.foto;
            if(previewImg)previewImg.src=user.foto;
            if(previewDiv)previewDiv.style.display='flex';
            currentUserFotoUrl=user.foto;
            if(fotoInput)fotoInput.value='';
            if(urlInput)urlInput.disabled=false;
        }else{
            if(urlInput)urlInput.value='';
            if(previewDiv)previewDiv.style.display='none';
            if(fotoInput)fotoInput.value='';
            if(urlInput)urlInput.disabled=false;
        }
        var modal=document.getElementById('usuarioModal');
        if(modal)modal.classList.add('active');
    };

    window.eliminarUsuario = async function(userId) {
        var user=window.usuarios.find(u=>u.id===userId);
        if(!user)return;
        if(user.rol==='admin'){
            var adminsActivos=window.usuarios.filter(function(u){return u.rol==='admin'&&u.activo===true;});
            if(adminsActivos.length===1){
                window.mostrarToast('⚠️ No se puede eliminar el único administrador. El sistema quedaría inoperativo.','error');
                return;
            }
        }
        window.mostrarConfirmacionPremium(
            'Eliminar Usuario',
            '¿Estás seguro de eliminar al usuario "'+user.nombre+'"? Esta acción no se puede deshacer.',
            async function(){
                try{
                    await window.supabaseClient.from('usuarios').delete().eq('id',userId);
                    await window.cargarUsuarios();
                    window.mostrarToast('🗑️ Usuario eliminado','success');
                }catch(e){
                    console.error('Error eliminando usuario:',e);
                    window.mostrarToast('❌ Error al eliminar usuario','error');
                }
            }
        );
    };

    // Guardar usuario (nuevo o edición)
    document.getElementById('saveUsuario').addEventListener('click', async () => {
        const btn = document.getElementById('saveUsuario');
        if (btn && btn.disabled) return;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'; }
        const nombre   = document.getElementById('usuarioNombre').value.trim();
        const username = document.getElementById('usuarioUsername').value.trim().toLowerCase();
        const emailRecuperacion = document.getElementById('usuarioEmailRecuperacion').value.trim().toLowerCase();
        const password = document.getElementById('usuarioPassword').value.trim();
        const rol = document.getElementById('usuarioRol').value;
        const activo = document.getElementById('usuarioActivo').value === 'true';
        
        if (!nombre || !username || !emailRecuperacion) {
            window.mostrarToast('Completa nombre, usuario y correo de recuperación', 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = 'Guardar'; }
            return;
        }
        
        // Validar formato de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(emailRecuperacion)) {
            window.mostrarToast('Ingresa un correo electrónico válido', 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = 'Guardar'; }
            return;
        }
        
        if (!window.usuarioEditandoId && !password) {
            window.mostrarToast('Ingresa una contraseña para el nuevo usuario', 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = 'Guardar'; }
            return;
        }
        
        // Subir foto si existe
        let fotoUrl = '';
        const archivoFoto = document.getElementById('usuarioFoto').files[0];
        const fotoUrlInput = document.getElementById('usuarioFotoUrl').value;
        if (archivoFoto) {
            const resultado = await window.subirImagenPlatillo(archivoFoto, 'usuarios');
            if (resultado.success) fotoUrl = resultado.url;
            else { window.mostrarToast('Error al subir la foto: ' + resultado.error, 'error'); return; }
        } else if (fotoUrlInput) fotoUrl = fotoUrlInput;
        
        try {
            let hashed = null;
            if (password) {
                const { data: h, error: hashErr } = await window.supabaseClient.rpc('hash_password', { plain_password: password });
                if (hashErr) throw hashErr;
                hashed = h;
            }
            const userData = {
                id: window.usuarioEditandoId || window.generarId('user_'),
                nombre,
                username,
                email_recuperacion: emailRecuperacion,  // Campo de correo compartido para recuperación centralizada
                rol,
                activo,
                foto: fotoUrl || null
            };
            if (hashed) userData.password_hash = hashed;
            
            let error;
            if (window.usuarioEditandoId) {
                ({ error } = await window.supabaseClient.from('usuarios').update(userData).eq('id', window.usuarioEditandoId));
            } else {
                ({ error } = await window.supabaseClient.from('usuarios').insert([userData]));
            }
            if (error) throw error;
            
            // Si es un administrador activo, guardarlo en el historial de recientes para el login
            if (rol === 'admin' && activo) {
                const adminData = {
                    id: userData.id,
                    nombre: userData.nombre,
                    username: userData.username,
                    email_recuperacion: userData.email_recuperacion,
                    foto: userData.foto,
                    rol: 'admin'
                };
                window.guardarAdminReciente(adminData);
            }
            
            document.getElementById('usuarioModal').classList.remove('active');
            window.usuarioEditandoId = null;
            await window.cargarUsuarios();
            window.mostrarToast('✅ Usuario guardado', 'success');
        } catch (e) {
            console.error('Error guardando usuario:', e);
            window.mostrarToast('❌ Error: ' + (e.message || e), 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = 'Guardar'; }
        }
    });

    // Cerrar modal
    document.getElementById('cancelUsuario').addEventListener('click', () => window.cerrarModal('usuarioModal'));
    document.getElementById('closeUsuarioModal').addEventListener('click', () => window.cerrarModal('usuarioModal'));
    
    // Configurar eventos de foto en el modal de usuario
    function setupUsuarioFotoEvents() {
        var fi=document.getElementById('usuarioFoto');
        var ui=document.getElementById('usuarioFotoUrl');
        var rb=document.getElementById('usuarioFotoRemoveBtn');
        if(fi)fi.addEventListener('change',handleUsuarioFotoFile);
        if(ui)ui.addEventListener('input',handleUsuarioFotoUrl);
        if(rb)rb.addEventListener('click',removeUsuarioFoto);
    }
    setupUsuarioFotoEvents();
})();

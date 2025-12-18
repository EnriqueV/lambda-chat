const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { comerciosTools } = require('./tools/comercios-tools');
const { connectMongoDB, closeMongoDB } = require('./tools/mongodb-connection');
const reviewsService = require('./tools/reviews-service');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURACIÓN ====================
app.use(cors({origin: true}));
app.use(express.json());

// ==================== INICIALIZACIÓN ====================
let mongoConectado = false;

async function inicializarServicio() {
  try {
    await connectMongoDB();
    mongoConectado = true;
    // Crear índices de reviews
    await reviewsService.crearIndices();
    console.log('✅ Servicio inicializado correctamente');
  } catch (error) {
    console.error('❌ Error al inicializar servicio:', error.message);
  }
}

// Inicializar al arrancar
inicializarServicio();

// ==================== FUNCIONES AUXILIARES ====================

/**
 * Procesa las tool calls de Claude y ejecuta las funciones correspondientes
 */
async function procesarToolCalls(toolCalls) {
  const resultados = [];

  for (const toolCall of toolCalls) {
    const { id, name, input } = toolCall;
    
    try {
      console.log(`🔧 Ejecutando tool: ${name}`);
      console.log(`📝 Parámetros:`, JSON.stringify(input, null, 2));
      
      // Ejecutar el handler correspondiente
      const handler = comerciosTools.handlers[name];
      if (!handler) {
        throw new Error(`Handler no encontrado para: ${name}`);
      }
      
      const resultado = await handler(input);
      
      console.log(`✅ Tool ${name} ejecutada exitosamente`);
      
      resultados.push({
        type: 'tool_result',
        tool_use_id: id,
        content: JSON.stringify(resultado, null, 2),
      });
    } catch (error) {
      console.error(`❌ Error ejecutando tool ${name}:`, error.message);
      
      resultados.push({
        type: 'tool_result',
        tool_use_id: id,
        is_error: true,
        content: `Error: ${error.message}`,
      });
    }
  }

  return resultados;
}

/**
 * Extrae texto y tool calls del contenido de Claude
 */
function extraerContenido(content) {
  let texto = '';
  const toolCalls = [];

  for (const block of content) {
    if (block.type === 'text') {
      texto += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push(block);
    }
  }

  return { texto, toolCalls };
}

// ==================== ENDPOINT PRINCIPAL DE CHAT ====================

app.post('/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    // Validaciones
    if (!message) {
      return res.status(400).json({ error: 'El mensaje es requerido' });
    }

    if (!mongoConectado) {
      return res.status(503).json({ 
        error: 'Servicio no disponible',
        details: 'La conexión a la base de datos no está lista'
      });
    }

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Configuración del servidor incompleta',
        hint: 'Configura CLAUDE_API_KEY en las variables de entorno'
      });
    }

    console.log(`\n💬 Nueva consulta: "${message.substring(0, 80)}..."`);

    // System prompt con instrucciones para el agente
    const systemPrompt = `Eres Frankie, un asistente virtual amigable y útil para una aplicación móvil de comercios locales en El Salvador.

    TU PROPÓSITO:
    - Ayudar a los usuarios a encontrar comercios y negocios locales
    - Proporcionar información detallada y precisa sobre servicios y productos
    - Facilitar el contacto directo con los negocios
    - Ofrecer recomendaciones personalizadas
    
    TU PERSONALIDAD:
    - Amable, profesional y cercano con los salvadoreños
    - Proactivo en ofrecer información útil
    - Conciso pero completo (estás en un chat móvil)
    - Honesto cuando no tienes información
    
    ESTRATEGIA DE BÚSQUEDA (MUY IMPORTANTE):
    Cuando el usuario busque algo:
    1. PRIMERO: Usa buscar_comercio con el parámetro "busqueda" (busca en nombre, descripción y tags)
    2. Si no encuentra nada, intenta buscar_por_categoria con palabras relacionadas
    3. Si aún no encuentra, intenta listar_comercios con filtros más amplios
    4. NUNCA te rindas con la primera búsqueda
    
    Ejemplos de búsqueda inteligente:
    - Usuario dice "delivery" → busca "delivery", "envío", "domicilio", "comida rápida"
    - Usuario dice "mecánica de motos" → busca "motos", "mecánica", "taller", "motocicletas"
    - Usuario dice "flores" → busca "flores", "floristería", "arreglos florales"
    
    HERRAMIENTAS DISPONIBLES:
    - buscar_comercio: USAR PRIMERO con parámetro "busqueda" para búsquedas flexibles
    - buscar_por_categoria: Para búsquedas por tags específicos
    - listar_comercios: Para mostrar listados generales
    - comercio_detalle_completo: Para obtener toda la información de un comercio
    - obtener_contacto_comercio: Para obtener datos de contacto específicos
    - comercios_verificados: Para mostrar opciones confiables
    - buscar_por_ubicacion: Para buscar por ciudad o zona
    
    CÓMO MANEJAR BÚSQUEDAS SIN RESULTADOS:
    Si una búsqueda no devuelve resultados:
    1. Intenta con términos relacionados o más generales
    2. Ofrece categorías similares que SÍ tengas
    3. Pregunta al usuario si busca algo más específico
    4. NUNCA digas simplemente "no tengo información" sin intentar alternativas
    
    FORMATO DE RESPUESTAS:
    - Usa emojis apropiados (📍 ubicación, 📞 teléfono, 💬 WhatsApp, etc.)
    - Estructura la información de forma clara
    - Siempre incluye datos de contacto cuando estén disponibles
    - Proporciona links de WhatsApp: wa.me/503XXXXXXXX
    - Si hay varios resultados, menciona los más relevantes
    
    IMPORTANTE - COMPARTIR COMERCIOS:
Cuando muestres información detallada de UN comercio específico al usuario, SIEMPRE debes:
1. Primero obtener los detalles del comercio con las tools normales
2. Luego USAR la tool "compartir_comercio_con_usuario" con el id, slug y nombre
3. Después presentar la información al usuario

Ejemplo correcto:
- Usuario: "dame info de Rosales Taller"
- Tú: [usas buscar_comercio para encontrarlo]
- Tú: [usas comercio_detalle_completo para obtener info]
- Tú: [usas compartir_comercio_con_usuario con el id y slug] ← IMPORTANTE
- Tú: [presentas la info al usuario]

NO uses compartir_comercio_con_usuario cuando:
- Muestres una LISTA de varios comercios
- Solo menciones un comercio de paso
- No tengas el slug del comercio`;

    // Construir mensajes iniciales
    let messages = [
      ...history,
      { role: 'user', content: message }
    ];

    let conversacionCompleta = false;
    let respuestaFinal = '';
    let iteraciones = 0;
    const MAX_ITERACIONES = 5;
    let comercioCompartido = null; // ✅ NUEVO: Variable para capturar comercio compartido

    // Loop para manejar tool calls
    while (!conversacionCompleta && iteraciones < MAX_ITERACIONES) {
      iteraciones++;
      
      console.log(`\n🔄 Iteración ${iteraciones} - Llamando a Claude...`);

      // Llamar a Claude con tools
      const claudeResponse = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: systemPrompt,
          messages: messages,
          tools: comerciosTools.tools,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          timeout: 60000,
        }
      );

      const { content, stop_reason } = claudeResponse.data;
      const { texto, toolCalls } = extraerContenido(content);

      console.log(`📊 Stop reason: ${stop_reason}`);
      console.log(`🔧 Tool calls: ${toolCalls.length}`);
      
      // ✅ NUEVO: Mostrar qué tools se están llamando
      if (toolCalls.length > 0) {
        console.log(`🔍 Tools llamadas:`, toolCalls.map(t => t.name).join(', '));
      }

      // Si hay texto, guardarlo
      if (texto) {
        respuestaFinal += texto;
      }

      // Si hay tool calls, ejecutarlas
      if (toolCalls.length > 0) {
        // ✅ NUEVO: Capturar si se compartió un comercio ANTES de ejecutar
        for (const toolCall of toolCalls) {
          if (toolCall.name === 'compartir_comercio_con_usuario') {
            comercioCompartido = {
              id: toolCall.input.id,
              slug: toolCall.input.slug,
              nombre: toolCall.input.nombre,
            };
            console.log('🏪 Comercio compartido capturado:', comercioCompartido);
          }
        }

        // Agregar el mensaje del asistente con los tool calls
        messages.push({
          role: 'assistant',
          content: content
        });

        // Ejecutar las tools
        const toolResults = await procesarToolCalls(toolCalls);

        // Agregar los resultados
        messages.push({
          role: 'user',
          content: toolResults
        });

        console.log(`✅ ${toolResults.length} tool(s) ejecutada(s), continuando conversación...`);
      } else {
        // No hay más tool calls, conversación completa
        conversacionCompleta = true;
      }

      // Si Claude indica que terminó (end_turn), salir del loop
      if (stop_reason === 'end_turn') {
        conversacionCompleta = true;
      }
    }

    console.log(`\n✅ Respuesta completada en ${iteraciones} iteración(es)`);
    console.log(`📝 Longitud de respuesta: ${respuestaFinal.length} caracteres`);
    
    // ✅ NUEVO: Log final del comercio compartido
    if (comercioCompartido) {
      console.log(`🏪 Comercio final compartido: ${comercioCompartido.nombre} (${comercioCompartido.slug})`);
    }

    // ✅ MODIFICADO: Responder al cliente con info del comercio
    res.json({
      message: respuestaFinal,
      itemSlug: comercioCompartido?.slug || null,     // ← NUEVO
      itemId: comercioCompartido?.id || null,         // ← NUEVO
      itemNombre: comercioCompartido?.nombre || null, // ← NUEVO
      metadata: {
        iteraciones: iteraciones,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error en /chat:', error.message);
    
    if (error.response) {
      console.error('📄 Respuesta de error:', error.response.data);
      return res.status(error.response.status).json({
        error: 'Error al comunicarse con Claude',
        details: error.response.data?.error?.message || 'Error desconocido',
        type: error.response.data?.error?.type
      });
    }
    
    res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message,
    });
  }
});

// ==================== ENDPOINTS AUXILIARES ====================

/**
 * Endpoint de prueba directo de tools (sin Claude)
 */
app.post('/test-tool', async (req, res) => {
  try {
    const { toolName, params } = req.body;
    
    if (!toolName) {
      return res.status(400).json({ error: 'toolName es requerido' });
    }

    const handler = comerciosTools.handlers[toolName];
    if (!handler) {
      return res.status(404).json({ error: `Tool '${toolName}' no encontrada` });
    }

    const resultado = await handler(params || {});
    
    res.json({
      tool: toolName,
      resultado: resultado,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error en /test-tool:', error);
    res.status(500).json({ 
      error: 'Error al ejecutar tool',
      details: error.message 
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  const claudeKeyConfigured = !!process.env.CLAUDE_API_KEY;
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Claude Chat API con Tools - Frankie',
    version: '3.0.0',
    configuracion: {
      claudeAPI: claudeKeyConfigured ? '✅ Configurada' : '❌ No configurada',
      mongodb: mongoConectado ? '✅ Conectado' : '❌ Desconectado',
      puerto: PORT,
      entorno: process.env.NODE_ENV || 'development'
    },
    tools_disponibles: comerciosTools.tools.map(t => ({
      nombre: t.name,
      descripcion: t.description
    }))
  });
});

/**
 * Crear una nueva review
 */
app.post('/reviews', async (req, res) => {
  try {
    const { item_id, reviewer_name, reviewer_email, rating, review_text } = req.body;

    if (!mongoConectado) {
      return res.status(503).json({ 
        error: 'Servicio no disponible',
        details: 'La conexión a la base de datos no está lista'
      });
    }

    // Verificar si el usuario ya dejó una review para este item
    const yaReviso = await reviewsService.usuarioYaRevisoItem(item_id, reviewer_email);
    if (yaReviso) {
      return res.status(409).json({
        error: 'Ya existe una review de este usuario para este item',
        suggestion: 'El usuario ya dejó una reseña para este producto/servicio'
      });
    }

    // Crear la review (las validaciones están en el servicio)
    const resultado = await reviewsService.crearReview({
      item_id,
      reviewer_name,
      reviewer_email,
      rating,
      review_text
    });

    console.log(`✅ Review creada para item ${item_id}`);

    res.status(201).json(resultado);

  } catch (error) {
    console.error('❌ Error en POST /reviews:', error.message);
    
    // Si es error de validación, retornar 400
    if (error.message.includes('Errores de validación')) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: error.message
      });
    }
    
    res.status(500).json({
      error: 'Error al crear review',
      details: error.message
    });
  }
});

/**
 * Obtener todas las reviews de un item
 */
app.get('/reviews/:item_id', async (req, res) => {
  try {
    const { item_id } = req.params;

    if (!item_id) {
      return res.status(400).json({
        error: 'item_id es requerido en la URL'
      });
    }

    if (!mongoConectado) {
      return res.status(503).json({ 
        error: 'Servicio no disponible',
        details: 'La conexión a la base de datos no está lista'
      });
    }

    const resultado = await reviewsService.obtenerReviewsPorItem(item_id);

    console.log(`✅ Reviews obtenidas para item ${item_id}: ${resultado.total_reviews} encontradas`);

    res.json(resultado);

  } catch (error) {
    console.error('❌ Error en GET /reviews/:item_id:', error.message);
    res.status(500).json({
      error: 'Error al obtener reviews',
      details: error.message
    });
  }
});

/**
 * Listar tools disponibles
 */
app.get('/tools', (req, res) => {
  res.json({
    total: comerciosTools.tools.length,
    tools: comerciosTools.tools
  });
});

/**
 * Root endpoint
 */
app.get('/', (req, res) => {
  res.json({
    servicio: 'Claude Chat API - Frankie Assistant con Tools',
    version: '3.0.0',
    descripcion: 'API de chat con herramientas inteligentes para consultar comercios',
    endpoints: {
      chat: {
        metodo: 'POST',
        ruta: '/chat',
        descripcion: 'Envía un mensaje al asistente virtual',
        body: { message: 'string', history: 'array (opcional)' }
      },
      testTool: {
        metodo: 'POST',
        ruta: '/test-tool',
        descripcion: 'Prueba una tool directamente sin Claude',
        body: { toolName: 'string', params: 'object' }
      },
      tools: {
        metodo: 'GET',
        ruta: '/tools',
        descripcion: 'Lista todas las tools disponibles'
      },
      health: {
        metodo: 'GET',
        ruta: '/health',
        descripcion: 'Verifica el estado del servicio'
      }
    },
    ejemplos: {
      chat: {
        url: '/chat',
        body: {
          message: 'Busco un lugar para hacer eventos',
          history: []
        }
      },
      testTool: {
        url: '/test-tool',
        body: {
          toolName: 'buscar_comercio',
          params: { nombre: 'Moment' }
        }
      }
    },
    documentacion: 'https://docs.anthropic.com'
  });
});

// ==================== MANEJO DE ERRORES ====================

app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint no encontrado',
    ruta: req.path,
    metodo: req.method,
    ayuda: 'Visita / para ver los endpoints disponibles'
  });
});

app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err);
  res.status(500).json({
    error: 'Error interno del servidor',
    mensaje: err.message
  });
});

// ==================== INICIAR SERVIDOR ====================

app.listen(PORT, () => {
  console.log('\n🚀 ================================');
  console.log('   Claude Chat API - Frankie v3.0');
  console.log('   ================================');
  console.log(`   Puerto: ${PORT}`);
  console.log(`   MongoDB: ${mongoConectado ? '✅' : '⏳ Conectando...'}`);
  console.log(`   Claude API: ${process.env.CLAUDE_API_KEY ? '✅' : '❌'}`);
  console.log(`   Tools: ${comerciosTools.tools.length} disponibles`);
  console.log('   ================================');
  console.log(`   💬 Chat: POST http://localhost:${PORT}/chat`);
  console.log(`   🔧 Test Tool: POST http://localhost:${PORT}/test-tool`);
  console.log(`   📋 Tools: GET http://localhost:${PORT}/tools`);
  console.log(`   🏥 Health: GET http://localhost:${PORT}/health`);
  console.log('   ================================\n');
});

// ==================== MANEJO DE SEÑALES ====================

process.on('SIGTERM', async () => {
  console.log('⚠️  SIGTERM recibido, cerrando servidor...');
  await closeMongoDB();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n⚠️  SIGINT recibido, cerrando servidor...');
  await closeMongoDB();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURACIÓN ====================
app.use(cors({origin: true}));
app.use(express.json());

// ==================== CARGA DE DATOS ====================
let comerciosData = [];

function cargarComercios() {
  try {
    const filePath = path.join(__dirname, 'renval_Item.json');
    comerciosData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`✅ ${comerciosData.length} comercios cargados exitosamente`);
    return true;
  } catch (error) {
    console.error('❌ Error cargando comercios:', error.message);
    return false;
  }
}

// Cargar al iniciar
cargarComercios();

// ==================== FUNCIONES DE BÚSQUEDA ====================

/**
 * Limpia el texto HTML de las descripciones
 */
function limpiarHTML(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '') // Remover tags HTML
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
    .substring(0, 600); // Limitar longitud
}

/**
 * Detecta la categoría del mensaje del usuario
 */
function detectarCategoria(mensaje) {
  const mensajeLower = mensaje.toLowerCase();
  
  const categorias = {
    'comida': ['restaurante', 'comida', 'pollo', 'pizza', 'cafetería', 'café', 'almuerzo', 'cena', 'desayuno', 'comedor', 'food', 'comer', 'hamburgues', 'tacos', 'pupusas'],
    'eventos': ['eventos', 'flores', 'decoración', 'bodas', 'boda', 'cumpleaños', 'fiesta', 'celebración', 'decorar', 'floristería'],
    'servicios': ['barbería', 'corte', 'pelo', 'barber', 'contadores', 'contabilidad', 'reparación', 'mecánico', 'taller', 'servicio'],
    'compras': ['super', 'tienda', 'mercado', 'minisuper', 'supermercado', 'compras', 'comprar', 'productos'],
    'salud': ['doctor', 'médico', 'clínica', 'farmacia', 'salud', 'medicina', 'dental', 'dentista'],
    'tecnología': ['tecnología', 'computadora', 'celular', 'teléfono', 'reparación', 'tech', 'electrónica']
  };
  
  for (const [categoria, keywords] of Object.entries(categorias)) {
    if (keywords.some(keyword => mensajeLower.includes(keyword))) {
      return categoria;
    }
  }
  
  return null;
}

/**
 * Busca comercios relevantes según el mensaje del usuario
 */
function buscarComerciosRelevantes(mensaje) {
  if (!mensaje || comerciosData.length === 0) {
    return [];
  }

  const mensajeLower = mensaje.toLowerCase();
  const palabrasClave = mensajeLower.split(' ').filter(p => p.length > 2);
  const categoria = detectarCategoria(mensaje);
  
  console.log(`🔍 Búsqueda: "${mensaje}"`);
  console.log(`📂 Categoría detectada: ${categoria || 'general'}`);

  // Función de scoring para rankear resultados
  const calcularScore = (comercio) => {
    let score = 0;
    const nombre = comercio.name?.toLowerCase() || '';
    const descripcion = comercio.description?.toLowerCase() || '';
    const tags = comercio.tags?.join(' ').toLowerCase() || '';
    const textoCompleto = `${nombre} ${descripcion} ${tags}`;

    // Coincidencia en el nombre (peso alto)
    palabrasClave.forEach(palabra => {
      if (nombre.includes(palabra)) score += 10;
    });

    // Coincidencia en tags (peso medio)
    palabrasClave.forEach(palabra => {
      if (tags.includes(palabra)) score += 5;
    });

    // Coincidencia en descripción (peso bajo)
    palabrasClave.forEach(palabra => {
      if (descripcion.includes(palabra)) score += 2;
    });

    // Bonus por categoría
    if (categoria) {
      const categoriaKeywords = {
        'comida': ['restaurante', 'comida', 'pollo', 'food'],
        'eventos': ['eventos', 'flores', 'decoración'],
        'servicios': ['servicio', 'barbería', 'contador'],
        'compras': ['super', 'tienda', 'mercado'],
      };
      
      const keywords = categoriaKeywords[categoria] || [];
      if (keywords.some(k => textoCompleto.includes(k))) {
        score += 15;
      }
    }

    // Bonus si está verificado
    if (comercio.verify) score += 3;

    // Bonus si tiene información de contacto completa
    if (comercio.whatsapp) score += 1;
    if (comercio.phone) score += 1;
    if (comercio.address) score += 1;

    return score;
  };

  // Calcular scores y filtrar
  const comerciosConScore = comerciosData
    .map(comercio => ({
      comercio,
      score: calcularScore(comercio)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5); // Top 5 resultados

  console.log(`✅ ${comerciosConScore.length} comercios encontrados`);

  // Formatear resultados
  return comerciosConScore.map(item => {
    const c = item.comercio;
    return {
      id: c._id,
      nombre: c.name,
      descripcion: limpiarHTML(c.description),
      direccion: c.address || 'No especificada',
      telefono: c.phone || null,
      whatsapp: c.whatsapp ? `+${c.whatsapp}` : null,
      email: c.email || null,
      horario: c.opening && c.closing 
        ? `${c.opening}:00 - ${c.closing}:00` 
        : 'Consultar',
      redes: {
        facebook: c.facebook || null,
        instagram: c.instagram || null,
        website: c.website || null
      },
      verificado: c.verify || false,
      tags: c.tags || [],
      score: item.score // Para debugging
    };
  });
}

// ==================== ENDPOINTS ====================

/**
 * Endpoint principal de chat con Claude
 */
app.post('/chat', async (req, res) => {
  try {
    const {message, history} = req.body;

    // Validaciones
    if (!message) {
      return res.status(400).json({error: 'El mensaje es requerido'});
    }

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      console.error('⚠️  CLAUDE_API_KEY no configurada');
      return res.status(500).json({
        error: 'Configuración del servidor incompleta',
        hint: 'Configura CLAUDE_API_KEY en las variables de entorno'
      });
    }

    // Buscar comercios relevantes
    const comerciosRelevantes = buscarComerciosRelevantes(message);
    
    // Construir system prompt base
    let systemPrompt = `Eres Frankie, un asistente virtual amigable y útil para una aplicación móvil de comercios locales en El Salvador.

PROPÓSITO:
- Ayudar a los usuarios a encontrar comercios y negocios locales
- Proporcionar información detallada sobre servicios y productos
- Facilitar el contacto con los negocios
- Responder preguntas generales de manera clara

PERSONALIDAD:
- Amable, profesional y cercano
- Proactivo en ofrecer información útil
- Conciso (estás en un chat móvil)
- Honesto cuando no tienes información

FORMATO DE RESPUESTAS:
- Usa emojis apropiados para hacer el chat más amigable
- Estructura la información de forma clara
- Incluye datos de contacto cuando sea relevante
- Si hay varios comercios relevantes, menciona los más apropiados`;

    // Agregar comercios al contexto si hay resultados
    if (comerciosRelevantes.length > 0) {
      systemPrompt += `\n\n📍 COMERCIOS RELEVANTES PARA ESTA CONSULTA:\n\n`;
      
      comerciosRelevantes.forEach((comercio, index) => {
        systemPrompt += `${index + 1}. ${comercio.nombre}\n`;
        systemPrompt += `   Descripción: ${comercio.descripcion.substring(0, 300)}...\n`;
        systemPrompt += `   📍 Dirección: ${comercio.direccion}\n`;
        if (comercio.telefono) systemPrompt += `   📞 Teléfono: ${comercio.telefono}\n`;
        if (comercio.whatsapp) systemPrompt += `   💬 WhatsApp: ${comercio.whatsapp}\n`;
        if (comercio.email) systemPrompt += `   📧 Email: ${comercio.email}\n`;
        systemPrompt += `   🕐 Horario: ${comercio.horario}\n`;
        if (comercio.verificado) systemPrompt += `   ✅ Comercio verificado\n`;
        systemPrompt += `\n`;
      });

      systemPrompt += `\nUSA ESTA INFORMACIÓN para responder de manera precisa y útil. Menciona los datos de contacto relevantes.`;
      
      console.log(`📊 Contexto: ${comerciosRelevantes.length} comercios agregados`);
    } else {
      systemPrompt += `\n\nNOTA: No se encontraron comercios específicos para esta consulta. Si el usuario busca algo específico, sugiere que reformule la búsqueda o pregunta de qué tipo de negocio necesita.`;
      console.log(`⚠️  No se encontraron comercios relevantes`);
    }

    // Construir mensajes
    const messages = [
      ...(history || []),
      {role: 'user', content: message},
    ];

    console.log(`💬 Procesando mensaje: "${message.substring(0, 50)}..."`);

    // Llamar a Claude API
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: 30000, // 30 segundos
      },
    );

    const assistantMessage = response.data.content[0].text;

    console.log(`✅ Respuesta generada (${assistantMessage.length} caracteres)`);
    console.log(`🔢 Tokens usados: ${response.data.usage?.input_tokens || 0} in / ${response.data.usage?.output_tokens || 0} out`);

    // Responder al cliente
    res.json({
      message: assistantMessage,
      conversationId: response.data.id,
      metadata: {
        comerciosEncontrados: comerciosRelevantes.length,
        tokensUsados: response.data.usage,
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

/**
 * Endpoint para buscar comercios directamente (sin Claude)
 */
app.get('/comercios/buscar', (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q) {
      // Si no hay query, devolver comercios destacados
      const destacados = comerciosData
        .filter(c => c.isFeatured || c.verify)
        .slice(0, parseInt(limit));
      
      return res.json({
        resultados: destacados.length,
        comercios: destacados.map(c => ({
          id: c._id,
          nombre: c.name,
          descripcion: limpiarHTML(c.description).substring(0, 150) + '...',
          verificado: c.verify,
          destacado: c.isFeatured
        }))
      });
    }
    
    const resultados = buscarComerciosRelevantes(q);
    
    res.json({
      query: q,
      resultados: resultados.length,
      comercios: resultados.slice(0, parseInt(limit))
    });
    
  } catch (error) {
    console.error('❌ Error en /comercios/buscar:', error);
    res.status(500).json({ error: 'Error al buscar comercios' });
  }
});

/**
 * Endpoint para obtener un comercio específico por ID
 */
app.get('/comercios/:id', (req, res) => {
  try {
    const comercio = comerciosData.find(c => c._id === req.params.id);
    
    if (!comercio) {
      return res.status(404).json({ 
        error: 'Comercio no encontrado',
        id: req.params.id 
      });
    }
    
    res.json({
      id: comercio._id,
      nombre: comercio.name,
      descripcion: limpiarHTML(comercio.description),
      direccion: comercio.address,
      telefono: comercio.phone,
      whatsapp: comercio.whatsapp,
      email: comercio.email,
      horario: {
        apertura: comercio.opening,
        cierre: comercio.closing
      },
      redes: {
        facebook: comercio.facebook,
        instagram: comercio.instagram,
        website: comercio.website,
        tiktok: comercio.tiktok,
        youtube: comercio.youtube
      },
      imagenes: comercio.images,
      tags: comercio.tags,
      verificado: comercio.verify,
      destacado: comercio.isFeatured,
      estadisticas: {
        vistas: comercio.views,
        likes: comercio.likeCount,
        calificacion: comercio.ratingAvg
      }
    });
    
  } catch (error) {
    console.error('❌ Error en /comercios/:id:', error);
    res.status(500).json({ error: 'Error al obtener comercio' });
  }
});

/**
 * Endpoint para obtener categorías disponibles
 */
app.get('/categorias', (req, res) => {
  try {
    const categorias = {
      comida: {
        nombre: 'Comida y Restaurantes',
        keywords: ['restaurante', 'comida', 'pollo', 'pizza', 'cafetería'],
        emoji: '🍽️'
      },
      eventos: {
        nombre: 'Eventos y Decoración',
        keywords: ['eventos', 'flores', 'decoración', 'bodas'],
        emoji: '🎉'
      },
      servicios: {
        nombre: 'Servicios',
        keywords: ['barbería', 'contadores', 'reparación'],
        emoji: '🔧'
      },
      compras: {
        nombre: 'Compras y Supermercados',
        keywords: ['super', 'tienda', 'mercado'],
        emoji: '🛒'
      },
      salud: {
        nombre: 'Salud y Bienestar',
        keywords: ['doctor', 'farmacia', 'clínica'],
        emoji: '⚕️'
      }
    };
    
    res.json({ categorias });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener categorías' });
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
    service: 'Claude Chat API con búsqueda inteligente',
    version: '2.0.0',
    comercios: {
      total: comerciosData.length,
      verificados: comerciosData.filter(c => c.verify).length,
      destacados: comerciosData.filter(c => c.isFeatured).length
    },
    configuracion: {
      claudeAPI: claudeKeyConfigured ? '✅ Configurada' : '❌ No configurada',
      puerto: PORT,
      entorno: process.env.NODE_ENV || 'development'
    }
  });
});

/**
 * Root endpoint
 */
app.get('/', (req, res) => {
  res.json({
    servicio: 'Claude Chat API - Frankie Assistant',
    version: '2.0.0',
    descripcion: 'API de chat con búsqueda inteligente de comercios locales',
    endpoints: {
      chat: {
        metodo: 'POST',
        ruta: '/chat',
        descripcion: 'Envía un mensaje al asistente virtual'
      },
      buscarComercios: {
        metodo: 'GET',
        ruta: '/comercios/buscar?q=palabra',
        descripcion: 'Busca comercios sin usar Claude'
      },
      obtenerComercio: {
        metodo: 'GET',
        ruta: '/comercios/:id',
        descripcion: 'Obtiene detalles de un comercio específico'
      },
      categorias: {
        metodo: 'GET',
        ruta: '/categorias',
        descripcion: 'Lista las categorías disponibles'
      },
      health: {
        metodo: 'GET',
        ruta: '/health',
        descripcion: 'Verifica el estado del servicio'
      }
    },
    documentacion: 'https://docs.anthropic.com'
  });
});

/**
 * Endpoint para recargar comercios (útil para desarrollo)
 */
app.post('/admin/reload-comercios', (req, res) => {
  const exito = cargarComercios();
  res.json({
    exito,
    comerciosCargados: comerciosData.length,
    timestamp: new Date().toISOString()
  });
});

// ==================== MANEJO DE ERRORES ====================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint no encontrado',
    ruta: req.path,
    metodo: req.method,
    ayuda: 'Visita / para ver los endpoints disponibles'
  });
});

// Error handler global
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
  console.log(`   Claude Chat API - Frankie`);
  console.log('   ================================');
  console.log(`   Puerto: ${PORT}`);
  console.log(`   Comercios cargados: ${comerciosData.length}`);
  console.log(`   Claude API: ${process.env.CLAUDE_API_KEY ? '✅' : '❌'}`);
  console.log('   ================================');
  console.log(`   💬 Chat: POST http://localhost:${PORT}/chat`);
  console.log(`   🔍 Búsqueda: GET http://localhost:${PORT}/comercios/buscar?q=texto`);
  console.log(`   🏥 Health: GET http://localhost:${PORT}/health`);
  console.log('   ================================\n');
});

// Manejo de señales de terminación
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM recibido, cerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n⚠️  SIGINT recibido, cerrando servidor...');
  process.exit(0);
});

// Manejo de errores no capturados
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});
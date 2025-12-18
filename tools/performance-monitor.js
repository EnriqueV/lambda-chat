const { getCollection } = require('./mongodb-connection');
const { getCachedResult, setCachedResult } = require('./cache-busquedas');
const { trackQuery } = require('./performance-monitor');

const comerciosTools = {
  // Definición de herramientas para Claude
  tools: [
    {
      name: 'buscar_inteligente',
      description: 'Búsqueda inteligente que combina múltiples criterios. Usa esto PRIMERO antes que otras tools de búsqueda.',
      input_schema: {
        type: 'object',
        properties: {
          terminos: { 
            type: 'array',
            items: { type: 'string' },
            description: 'Array de términos de búsqueda (palabras clave, sinónimos, términos relacionados)' 
          },
          limite: { type: 'number', description: 'Límite de resultados', default: 10 },
        },
        required: ['terminos'],
      },
    },
    {
      name: 'buscar_comercio',
      description: 'Busca información de un comercio por nombre, ID o palabra clave. Útil cuando el usuario pregunta por un negocio específico.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID del comercio (_id en MongoDB)' },
          nombre: { type: 'string', description: 'Nombre del comercio (búsqueda parcial)' },
          slug: { type: 'string', description: 'Slug del comercio' },
          busqueda: { type: 'string', description: 'Búsqueda general en nombre, descripción y tags' },
        },
      },
    },
    {
      name: 'listar_comercios',
      description: 'Lista comercios con filtros opcionales. Útil para mostrar opciones o categorías.',
      input_schema: {
        type: 'object',
        properties: {
          verificado: { type: 'boolean', description: 'Filtrar por comercios verificados' },
          destacado: { type: 'boolean', description: 'Filtrar por comercios destacados (isFeatured)' },
          limite: { type: 'number', description: 'Número máximo de resultados', default: 10 },
          offset: { type: 'number', description: 'Desplazamiento para paginación', default: 0 },
        },
      },
    },
    {
      name: 'comercio_detalle_completo',
      description: 'Obtiene toda la información detallada de un comercio específico incluyendo contacto, redes sociales, horarios e imágenes.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID del comercio' },
        },
        required: ['id'],
      },
    },
    {
      name: 'buscar_por_categoria',
      description: 'Busca comercios por categoría o tags. Útil para búsquedas temáticas como "restaurantes", "eventos", "flores".',
      input_schema: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: 'Tag o palabra clave a buscar en los tags del comercio' },
          limite: { type: 'number', description: 'Límite de resultados', default: 10 },
        },
        required: ['tag'],
      },
    },
    {
      name: 'obtener_contacto_comercio',
      description: 'Obtiene específicamente la información de contacto de un comercio (teléfono, WhatsApp, email, redes sociales).',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID del comercio' },
        },
        required: ['id'],
      },
    },
    {
      name: 'comercios_verificados',
      description: 'Lista comercios verificados y confiables. Útil cuando el usuario busca opciones de calidad.',
      input_schema: {
        type: 'object',
        properties: {
          limite: { type: 'number', description: 'Límite de resultados', default: 10 },
        },
      },
    },
    {
      name: 'buscar_por_ubicacion',
      description: 'Busca comercios cerca de una ubicación específica o ciudad.',
      input_schema: {
        type: 'object',
        properties: {
          ciudad: { type: 'string', description: 'Ciudad o zona a buscar' },
          direccion: { type: 'string', description: 'Parte de la dirección a buscar' },
          limite: { type: 'number', description: 'Límite de resultados', default: 10 },
        },
      },
    },
    {
      name: 'compartir_comercio_con_usuario',
      description: 'SIEMPRE usa esta tool cuando muestres información detallada de UN comercio específico al usuario.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID del comercio' },
          slug: { type: 'string', description: 'Slug del comercio' },
          nombre: { type: 'string', description: 'Nombre del comercio' },
        },
        required: ['id', 'slug', 'nombre'],
      },
    },
    {
      name: 'explorar_categorias_disponibles',
      description: 'Obtiene TODAS las categorías/tags que existen en la base de datos. USA ESTO cuando no encuentres resultados.',
      input_schema: {
        type: 'object',
        properties: {
          limite: { type: 'number', description: 'Límite de categorías a mostrar', default: 30 },
        },
      },
    },
  ],

  // Funciones ejecutoras
  handlers: {
    buscar_inteligente: async (args) => {
      const startTime = Date.now();
      
      try {
        // ✅ Intentar caché primero
        const cached = getCachedResult('buscar_inteligente', args);
        if (cached) {
          trackQuery('buscar_inteligente', Date.now() - startTime, cached.length);
          return cached;
        }

        const collection = await getCollection('Item');
        const terminos = args.terminos || [];
        
        const conditions = [];
        for (const termino of terminos) {
          conditions.push(
            { name: { $regex: termino, $options: 'i' } },
            { description: { $regex: termino, $options: 'i' } },
            { tags: { $regex: termino, $options: 'i' } },
            { address: { $regex: termino, $options: 'i' } }
          );
        }
        
        const comercios = await collection
          .find({
            status: 'Active',
            $or: conditions
          })
          .limit(args.limite || 10)
          .toArray();
    
        const result = comercios.map(c => ({
          id: c._id,
          nombre: c.name,
          descripcion: limpiarHTML(c.description).substring(0, 200) + '...',
          slug: c.slug,
          direccion: c.address || 'No disponible',
          telefono: c.phone || null,
          whatsapp: c.whatsapp || null,
          verificado: c.verify || false,
          tags: c.tags || [],
          calificacion: c.ratingAvg || 0,
        }));

        // ✅ Guardar en caché
        setCachedResult('buscar_inteligente', args, result);
        
        const duration = Date.now() - startTime;
        trackQuery('buscar_inteligente', duration, result.length);
        console.log(`⏱️ buscar_inteligente: ${duration}ms - ${result.length} resultados`);
        
        return result;
      } catch (error) {
        console.error('Error en buscar_inteligente:', error);
        trackQuery('buscar_inteligente', Date.now() - startTime, 0);
        throw error;
      }
    },

    buscar_comercio: async (args) => {
      const startTime = Date.now();
      
      try {
        // ✅ Intentar caché primero
        const cached = getCachedResult('buscar_comercio', args);
        if (cached) {
          trackQuery('buscar_comercio', Date.now() - startTime, cached.length);
          return cached;
        }

        const collection = await getCollection('Item');
        let query = { status: 'Active' };

        if (args.id) {
          query._id = args.id;
        } else if (args.slug) {
          query.slug = args.slug;
        } else if (args.nombre) {
          query.$text = { $search: args.nombre };
        } else if (args.busqueda) {
          query.$text = { $search: args.busqueda };
        }

        const comercios = await collection
          .find(query, {
            projection: args.busqueda || args.nombre ? { score: { $meta: 'textScore' } } : {}
          })
          .sort(
            args.busqueda || args.nombre ? { score: { $meta: 'textScore' } } : { views: -1 }
          )
          .limit(5)
          .toArray();

        const result = comercios.map(c => ({
          id: c._id,
          nombre: c.name,
          descripcion: limpiarHTML(c.description),
          slug: c.slug,
          direccion: c.address || 'No disponible',
          telefono: c.phone || null,
          verificado: c.verify || false,
          destacado: c.isFeatured || false,
          tags: c.tags || [],
          relevancia: c.score || 0,
        }));

        // ✅ Guardar en caché
        setCachedResult('buscar_comercio', args, result);
        
        const duration = Date.now() - startTime;
        trackQuery('buscar_comercio', duration, result.length);
        console.log(`⏱️ buscar_comercio: ${duration}ms - ${result.length} resultados`);

        return result;
      } catch (error) {
        console.error('Error en buscar_comercio:', error);
        trackQuery('buscar_comercio', Date.now() - startTime, 0);
        throw error;
      }
    },

    compartir_comercio_con_usuario: async (args) => {
      const startTime = Date.now();
      console.log(`📤 Compartiendo comercio: ${args.nombre}`);
      
      const result = {
        success: true,
        message: `Comercio ${args.nombre} compartido exitosamente`,
        data: {
          id: args.id,
          slug: args.slug,
          nombre: args.nombre,
        }
      };
      
      trackQuery('compartir_comercio_con_usuario', Date.now() - startTime, 1);
      return result;
    },

    explorar_categorias_disponibles: async (args) => {
      const startTime = Date.now();
      
      try {
        // ✅ Intentar caché primero
        const cached = getCachedResult('explorar_categorias', args);
        if (cached) {
          trackQuery('explorar_categorias_disponibles', Date.now() - startTime, cached.categorias_populares.length);
          return cached;
        }

        const collection = await getCollection('Item');
        
        // ✅ MEJORADO: Usar agregación (más rápido)
        const resultado = await collection.aggregate([
          { $match: { status: 'Active' } },
          { $unwind: '$tags' },
          { 
            $group: {
              _id: '$tags',
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } },
          { $limit: args.limite || 30 },
          {
            $project: {
              _id: 0,
              categoria: '$_id',
              cantidad_comercios: '$count'
            }
          }
        ]).toArray();
        
        const result = {
          total_categorias: resultado.length,
          categorias_populares: resultado,
          mensaje: `Hay ${resultado.length} categorías disponibles`
        };

        // ✅ Guardar en caché
        setCachedResult('explorar_categorias', args, result);
        
        const duration = Date.now() - startTime;
        trackQuery('explorar_categorias_disponibles', duration, resultado.length);
        console.log(`⏱️ explorar_categorias: ${duration}ms - ${resultado.length} categorías`);
        
        return result;
      } catch (error) {
        console.error('Error en explorar_categorias_disponibles:', error);
        trackQuery('explorar_categorias_disponibles', Date.now() - startTime, 0);
        throw error;
      }
    },

    listar_comercios: async (args) => {
      const startTime = Date.now();
      
      try {
        const cached = getCachedResult('listar_comercios', args);
        if (cached) {
          trackQuery('listar_comercios', Date.now() - startTime, cached.length);
          return cached;
        }

        const collection = await getCollection('Item');
        let query = { status: 'Active' };

        if (typeof args.verificado === 'boolean') {
          query.verify = args.verificado;
        }
        if (typeof args.destacado === 'boolean') {
          query.isFeatured = args.destacado;
        }

        const comercios = await collection
          .find(query, {
            projection: {
              _id: 1, name: 1, description: 1, address: 1,
              verify: 1, isFeatured: 1, views: 1, ratingAvg: 1
            }
          })
          .sort({ views: -1 })
          .skip(args.offset || 0)
          .limit(args.limite || 10)
          .toArray();

        const result = comercios.map(c => ({
          id: c._id,
          nombre: c.name,
          descripcion: limpiarHTML(c.description).substring(0, 200) + '...',
          direccion: c.address || 'No disponible',
          verificado: c.verify || false,
          destacado: c.isFeatured || false,
          vistas: c.views || 0,
          calificacion: c.ratingAvg || 0,
        }));

        setCachedResult('listar_comercios', args, result);
        
        const duration = Date.now() - startTime;
        trackQuery('listar_comercios', duration, result.length);
        console.log(`⏱️ listar_comercios: ${duration}ms - ${result.length} resultados`);

        return result;
      } catch (error) {
        console.error('Error en listar_comercios:', error);
        trackQuery('listar_comercios', Date.now() - startTime, 0);
        throw error;
      }
    },

    comercio_detalle_completo: async (args) => {
      const startTime = Date.now();
      
      try {
        const cached = getCachedResult('comercio_detalle', args);
        if (cached) {
          trackQuery('comercio_detalle_completo', Date.now() - startTime, 1);
          return cached;
        }

        const collection = await getCollection('Item');
        const comercio = await collection.findOne({ 
          _id: args.id,
          status: 'Active'
        });

        if (!comercio) {
          trackQuery('comercio_detalle_completo', Date.now() - startTime, 0);
          return null;
        }

        const result = {
          id: comercio._id,
          nombre: comercio.name,
          descripcion: limpiarHTML(comercio.description),
          descripcion_completa: comercio.description,
          slug: comercio.slug,
          contacto: {
            direccion: comercio.address || 'No disponible',
            telefono: comercio.phone || null,
            whatsapp: comercio.whatsapp || null,
            email: comercio.email || null,
          },
          redes_sociales: {
            facebook: comercio.facebook || null,
            instagram: comercio.instagram || null,
            website: comercio.website || null,
            tiktok: comercio.tiktok || null,
            youtube: comercio.youtube || null,
          },
          horario: comercio.opening && comercio.closing 
            ? `${comercio.opening}:00 - ${comercio.closing}:00`
            : 'No especificado',
          apertura: comercio.opening || null,
          cierre: comercio.closing || null,
          ubicacion: {
            latitud: comercio.lat || null,
            longitud: comercio.lng || null,
          },
          precio: comercio.price || null,
          precio_oferta: comercio.salePrice || null,
          descuento: comercio.discount || 0,
          precio_neto: comercio.netPrice || null,
          verificado: comercio.verify || false,
          destacado: comercio.isFeatured || false,
          activo: comercio.status === 'Active',
          nuevo: comercio.isNewArrival || false,
          disponible: !comercio.isNotAvailable,
          estadisticas: {
            vistas: comercio.views || 0,
            likes: comercio.likeCount || 0,
            calificaciones: comercio.ratingCount || 0,
            calificacion_promedio: comercio.ratingAvg || 0,
          },
          tags: comercio.tags || [],
          marca: comercio.brand || null,
          imagen_destacada: comercio.featuredImage || null,
          imagenes: comercio.images || [],
          creado: comercio._created_at || null,
          actualizado: comercio._updated_at || null,
        };

        setCachedResult('comercio_detalle', args, result);
        
        const duration = Date.now() - startTime;
        trackQuery('comercio_detalle_completo', duration, 1);
        console.log(`⏱️ comercio_detalle: ${duration}ms`);

        return result;
      } catch (error) {
        console.error('Error en comercio_detalle_completo:', error);
        trackQuery('comercio_detalle_completo', Date.now() - startTime, 0);
        throw error;
      }
    },

    buscar_por_categoria: async (args) => {
      const startTime = Date.now();
      
      try {
        const cached = getCachedResult('buscar_categoria', args);
        if (cached) {
          trackQuery('buscar_por_categoria', Date.now() - startTime, cached.length);
          return cached;
        }

        const collection = await getCollection('Item');
        
        const comercios = await collection
          .find({
            tags: { $regex: args.tag, $options: 'i' },
            status: 'Active'
          })
          .limit(args.limite || 10)
          .toArray();

        const result = comercios.map(c => ({
          id: c._id,
          nombre: c.name,
          descripcion: limpiarHTML(c.description).substring(0, 200) + '...',
          slug: c.slug,
          direccion: c.address || 'No disponible',
          telefono: c.phone || null,
          whatsapp: c.whatsapp || null,
          verificado: c.verify || false,
          tags: c.tags || [],
          calificacion: c.ratingAvg || 0,
        }));

        setCachedResult('buscar_categoria', args, result);
        
        const duration = Date.now() - startTime;
        trackQuery('buscar_por_categoria', duration, result.length);
        console.log(`⏱️ buscar_categoria: ${duration}ms - ${result.length} resultados`);

        return result;
      } catch (error) {
        console.error('Error en buscar_por_categoria:', error);
        trackQuery('buscar_por_categoria', Date.now() - startTime, 0);
        throw error;
      }
    },

    obtener_contacto_comercio: async (args) => {
      const startTime = Date.now();
      
      try {
        const cached = getCachedResult('contacto', args);
        if (cached) {
          trackQuery('obtener_contacto_comercio', Date.now() - startTime, 1);
          return cached;
        }

        const collection = await getCollection('Item');
        const comercio = await collection.findOne({ 
          _id: args.id,
          status: 'Active'
        }, {
          projection: {
            _id: 1, name: 1, phone: 1, whatsapp: 1, email: 1,
            address: 1, facebook: 1, instagram: 1, website: 1,
            tiktok: 1, youtube: 1, opening: 1, closing: 1, verify: 1
          }
        });

        if (!comercio) {
          trackQuery('obtener_contacto_comercio', Date.now() - startTime, 0);
          return null;
        }

        const result = {
          id: comercio._id,
          nombre: comercio.name,
          contacto: {
            telefono: comercio.phone || 'No disponible',
            whatsapp: comercio.whatsapp ? `+${comercio.whatsapp}` : 'No disponible',
            email: comercio.email || 'No disponible',
            direccion: comercio.address || 'No disponible',
          },
          redes_sociales: {
            facebook: comercio.facebook || 'No disponible',
            instagram: comercio.instagram || 'No disponible',
            website: comercio.website || 'No disponible',
            tiktok: comercio.tiktok || null,
            youtube: comercio.youtube || null,
          },
          horario: comercio.opening && comercio.closing 
            ? `De ${comercio.opening}:00 a ${comercio.closing}:00`
            : 'Horario no especificado',
          verificado: comercio.verify || false,
        };

        setCachedResult('contacto', args, result);
        
        const duration = Date.now() - startTime;
        trackQuery('obtener_contacto_comercio', duration, 1);
        console.log(`⏱️ contacto: ${duration}ms`);

        return result;
      } catch (error) {
        console.error('Error en obtener_contacto_comercio:', error);
        trackQuery('obtener_contacto_comercio', Date.now() - startTime, 0);
        throw error;
      }
    },

    comercios_verificados: async (args) => {
      const startTime = Date.now();
      
      try {
        const cached = getCachedResult('verificados', args);
        if (cached) {
          trackQuery('comercios_verificados', Date.now() - startTime, cached.length);
          return cached;
        }

        const collection = await getCollection('Item');
        
        const comercios = await collection
          .find({ 
            verify: true,
            status: 'Active'
          }, {
            projection: {
              _id: 1, name: 1, description: 1, address: 1,
              phone: 1, whatsapp: 1, tags: 1, ratingAvg: 1, views: 1
            }
          })
          .sort({ views: -1 })
          .limit(args.limite || 10)
          .toArray();

        const result = comercios.map(c => ({
          id: c._id,
          nombre: c.name,
          descripcion: limpiarHTML(c.description).substring(0, 150) + '...',
          direccion: c.address || 'No disponible',
          telefono: c.phone || null,
          whatsapp: c.whatsapp || null,
          tags: c.tags || [],
          calificacion: c.ratingAvg || 0,
          vistas: c.views || 0,
        }));

        setCachedResult('verificados', args, result);
        
        const duration = Date.now() - startTime;
        trackQuery('comercios_verificados', duration, result.length);
        console.log(`⏱️ verificados: ${duration}ms - ${result.length} resultados`);

        return result;
      } catch (error) {
        console.error('Error en comercios_verificados:', error);
        trackQuery('comercios_verificados', Date.now() - startTime, 0);
        throw error;
      }
    },

    buscar_por_ubicacion: async (args) => {
      const startTime = Date.now();
      
      try {
        const cached = getCachedResult('ubicacion', args);
        if (cached) {
          trackQuery('buscar_por_ubicacion', Date.now() - startTime, cached.length);
          return cached;
        }

        const collection = await getCollection('Item');
        let query = { status: 'Active' };

        if (args.ciudad) {
          query.$or = [
            { address: { $regex: args.ciudad, $options: 'i' } },
            { city: { $regex: args.ciudad, $options: 'i' } },
          ];
        } else if (args.direccion) {
          query.address = { $regex: args.direccion, $options: 'i' };
        }

        const comercios = await collection
          .find(query)
          .limit(args.limite || 10)
          .toArray();

        const result = comercios.map(c => ({
          id: c._id,
          nombre: c.name,
          descripcion: limpiarHTML(c.description).substring(0, 150) + '...',
          direccion: c.address || 'No disponible',
          telefono: c.phone || null,
          whatsapp: c.whatsapp || null,
          ubicacion: {
            latitud: c.lat || null,
            longitud: c.lng || null,
          },
          verificado: c.verify || false,
        }));

        setCachedResult('ubicacion', args, result);
        
        const duration = Date.now() - startTime;
        trackQuery('buscar_por_ubicacion', duration, result.length);
        console.log(`⏱️ ubicacion: ${duration}ms - ${result.length} resultados`);

        return result;
      } catch (error) {
        console.error('Error en buscar_por_ubicacion:', error);
        trackQuery('buscar_por_ubicacion', Date.now() - startTime, 0);
        throw error;
      }
    },
  },
};

// Función auxiliar para limpiar HTML
function limpiarHTML(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

module.exports = { comerciosTools };
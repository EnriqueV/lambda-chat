// tools/comercios-tools.js
const { getCollection } = require('./mongodb-connection');

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
      description: 'SIEMPRE usa esta tool cuando muestres información detallada de UN comercio específico al usuario. Esto permite que el usuario pueda ir directamente a ver el comercio completo.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID del comercio que estás mostrando' },
          slug: { type: 'string', description: 'Slug del comercio' },
          nombre: { type: 'string', description: 'Nombre del comercio' },
        },
        required: ['id', 'slug', 'nombre'],
      },
    },
  ],

  // Funciones ejecutoras
  handlers: {
    buscar_inteligente: async (args) => {
      try {
        const collection = await getCollection('Item');
        const terminos = args.terminos || [];
        
        // Construir query con $or para buscar cualquier término
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
    
        return comercios.map(c => ({
          id: c._id,
          nombre: c.name,
          descripcion: limpiarHTML(c.description).substring(0, 200) + '...',
          direccion: c.address || 'No disponible',
          telefono: c.phone || null,
          whatsapp: c.whatsapp || null,
          verificado: c.verify || false,
          tags: c.tags || [],
          calificacion: c.ratingAvg || 0,
        }));
      } catch (error) {
        console.error('Error en buscar_inteligente:', error);
        throw error;
      }
    },
    compartir_comercio_con_usuario: async (args) => {
      // Esta tool solo retorna metadata, no ejecuta nada
      return {
        compartido: true,
        comercio: {
          id: args.id,
          slug: args.slug,
          nombre: args.nombre,
        },
        mensaje: `Comercio compartido: ${args.nombre}`,
      };
    },
    buscar_comercio: async (args) => {
      try {
        const collection = await getCollection('Item');
        let query = { status: 'Active' }; // ✅ Solo comercios activos

        if (args.id) {
          query._id = args.id;
        } else if (args.slug) {
          query.slug = args.slug;
        } else if (args.nombre) {
          query.name = { $regex: args.nombre, $options: 'i' };
        } else if (args.busqueda) {
          query.$or = [
            { name: { $regex: args.busqueda, $options: 'i' } },
            { description: { $regex: args.busqueda, $options: 'i' } },
            { tags: { $regex: args.busqueda, $options: 'i' } },
          ];
        }

        const comercios = await collection
          .find(query)
          .limit(5)
          .toArray();

        return comercios.map(c => ({
          id: c._id,
          nombre: c.name,
          descripcion: limpiarHTML(c.description),
          slug: c.slug,
          direccion: c.address || 'No disponible',
          telefono: c.phone || null,
          verificado: c.verify || false,
          destacado: c.isFeatured || false,
          tags: c.tags || [],
        }));
      } catch (error) {
        console.error('Error en buscar_comercio:', error);
        throw error;
      }
    },

    listar_comercios: async (args) => {
      try {
        const collection = await getCollection('Item');
        let query = { status: 'Active' }; // ✅ Solo comercios activos por defecto

        if (typeof args.verificado === 'boolean') {
          query.verify = args.verificado;
        }
        if (typeof args.destacado === 'boolean') {
          query.isFeatured = args.destacado;
        }

        const comercios = await collection
          .find(query)
          .sort({ views: -1 }) // Ordenar por más vistos
          .skip(args.offset || 0)
          .limit(args.limite || 10)
          .toArray();

        return comercios.map(c => ({
          id: c._id,
          nombre: c.name,
          descripcion: limpiarHTML(c.description).substring(0, 200) + '...',
          direccion: c.address || 'No disponible',
          verificado: c.verify || false,
          destacado: c.isFeatured || false,
          vistas: c.views || 0,
          calificacion: c.ratingAvg || 0,
        }));
      } catch (error) {
        console.error('Error en listar_comercios:', error);
        throw error;
      }
    },

    comercio_detalle_completo: async (args) => {
      try {
        const collection = await getCollection('Item');
        const comercio = await collection.findOne({ 
          _id: args.id,
          status: 'Active' // ✅ Solo comercios activos
        });

        if (!comercio) {
          return null;
        }

        return {
          id: comercio._id,
          nombre: comercio.name,
          descripcion: limpiarHTML(comercio.description),
          descripcion_completa: comercio.description, // HTML completo
          slug: comercio.slug,
          
          // Información de contacto
          contacto: {
            direccion: comercio.address || 'No disponible',
            telefono: comercio.phone || null,
            whatsapp: comercio.whatsapp || null,
            email: comercio.email || null,
          },
          
          // Redes sociales
          redes_sociales: {
            facebook: comercio.facebook || null,
            instagram: comercio.instagram || null,
            website: comercio.website || null,
            tiktok: comercio.tiktok || null,
            youtube: comercio.youtube || null,
          },
          
          // Horarios
          horario: comercio.opening && comercio.closing 
            ? `${comercio.opening}:00 - ${comercio.closing}:00`
            : 'No especificado',
          apertura: comercio.opening || null,
          cierre: comercio.closing || null,
          
          // Ubicación
          ubicacion: {
            latitud: comercio.lat || null,
            longitud: comercio.lng || null,
          },
          
          // Información adicional
          precio: comercio.price || null,
          precio_oferta: comercio.salePrice || null,
          descuento: comercio.discount || 0,
          precio_neto: comercio.netPrice || null,
          
          // Estado
          verificado: comercio.verify || false,
          destacado: comercio.isFeatured || false,
          activo: comercio.status === 'Active',
          nuevo: comercio.isNewArrival || false,
          disponible: !comercio.isNotAvailable,
          
          // Estadísticas
          estadisticas: {
            vistas: comercio.views || 0,
            likes: comercio.likeCount || 0,
            calificaciones: comercio.ratingCount || 0,
            calificacion_promedio: comercio.ratingAvg || 0,
          },
          
          // Categorización
          tags: comercio.tags || [],
          marca: comercio.brand || null,
          
          // Imágenes
          imagen_destacada: comercio.featuredImage || null,
          imagenes: comercio.images || [],
          
          // Metadatos
          creado: comercio._created_at || null,
          actualizado: comercio._updated_at || null,
        };
      } catch (error) {
        console.error('Error en comercio_detalle_completo:', error);
        throw error;
      }
    },

    buscar_por_categoria: async (args) => {
      try {
        const collection = await getCollection('Item');
        
        const comercios = await collection
          .find({
            tags: { $regex: args.tag, $options: 'i' },
            status: 'Active' // ✅ Solo comercios activos
          })
          .limit(args.limite || 10)
          .toArray();

        return comercios.map(c => ({
          id: c._id,
          nombre: c.name,
          descripcion: limpiarHTML(c.description).substring(0, 200) + '...',
          direccion: c.address || 'No disponible',
          telefono: c.phone || null,
          whatsapp: c.whatsapp || null,
          verificado: c.verify || false,
          tags: c.tags || [],
          calificacion: c.ratingAvg || 0,
        }));
      } catch (error) {
        console.error('Error en buscar_por_categoria:', error);
        throw error;
      }
    },

    obtener_contacto_comercio: async (args) => {
      try {
        const collection = await getCollection('Item');
        const comercio = await collection.findOne({ 
          _id: args.id,
          status: 'Active' // ✅ Solo comercios activos
        });

        if (!comercio) {
          return null;
        }

        return {
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
      } catch (error) {
        console.error('Error en obtener_contacto_comercio:', error);
        throw error;
      }
    },

    comercios_verificados: async (args) => {
      try {
        const collection = await getCollection('Item');
        
        const comercios = await collection
          .find({ 
            verify: true,
            status: 'Active' // ✅ Solo comercios activos
          })
          .sort({ views: -1 })
          .limit(args.limite || 10)
          .toArray();

        return comercios.map(c => ({
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
      } catch (error) {
        console.error('Error en comercios_verificados:', error);
        throw error;
      }
    },

    buscar_por_ubicacion: async (args) => {
      try {
        const collection = await getCollection('Item');
        let query = { status: 'Active' }; // ✅ Solo comercios activos

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

        return comercios.map(c => ({
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
      } catch (error) {
        console.error('Error en buscar_por_ubicacion:', error);
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
import { validateDto } from '../../../utils/testing/dto-validation.util';
import { STORYTIME_LIMITS } from '../../constants/storytime-limits.constants';
import { PreviewContentDto } from './preview-content.dto';

describe('PreviewContentDto Validation', () => {
  const maxLength = STORYTIME_LIMITS.MAX_CONTENT_LENGTH.defaultValue;

  it('should accept Markdown source', async () => {
    const { errors } = await validateDto(PreviewContentDto, {
      contentSource: 'The **Enterprise** broke orbit.',
    });

    expect(errors).toHaveLength(0);
  });

  // An empty editor is a legitimate thing to preview, and answering it with a
  // validation error would mean the Preview tab failed on a new Chapter.
  it('should accept an omitted source', async () => {
    const { errors } = await validateDto(PreviewContentDto, {});

    expect(errors).toHaveLength(0);
  });

  it('should accept source at the Chapter body ceiling', async () => {
    const { errors } = await validateDto(PreviewContentDto, {
      contentSource: 'a'.repeat(maxLength),
    });

    expect(errors).toHaveLength(0);
  });

  // The cap is what keeps an unauthenticated-sized body off the renderer: the
  // route is a POST with no entity behind it, so this is its only size limit
  // besides the global body parser.
  it('should reject source past the ceiling', async () => {
    const { errors } = await validateDto(PreviewContentDto, {
      contentSource: 'a'.repeat(maxLength + 1),
    });

    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('should reject a non-string source', async () => {
    const { errors } = await validateDto(PreviewContentDto, {
      contentSource: 42,
    });

    expect(errors[0].constraints).toHaveProperty('isString');
  });

  it('should reject properties it does not define', async () => {
    const { errors } = await validateDto(PreviewContentDto, {
      contentSource: 'fine',
      chapterId: 'not yours to send',
    });

    expect(errors[0].constraints).toHaveProperty('whitelistValidation');
  });
});

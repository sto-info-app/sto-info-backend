import { Module } from '@nestjs/common';

import { FileScanningModule } from 'src/file-scanning/file-scanning.module';
import { SharedModule } from 'src/shared/shared.module';

import { FileAssetsModule } from './file-assets.module';
import { AssetIngressService } from './services/asset-ingress.service';
import { ImageIngressService } from './services/image-ingress.service';

/**
 * The route from a request holding bytes to an asset waiting for a scanner.
 *
 * A module of its own for one structural reason. `FileScanningModule` imports
 * `FileAssetsModule`, because putting a message on the scan queue moves the
 * registry; ingress needs both, because it writes the registry and then puts
 * the message on the queue. Were it a provider of either, the two would
 * import each other and Nest would refuse to start — the same reason
 * `RosterImportIngressService` lives in the Fleet module rather than in
 * either of the two it joins.
 *
 * So the sequence lives here, and the ten upload callers import this rather
 * than assembling it themselves. Ten copies of the same six steps is how
 * the one that forgets to register an asset gets written.
 *
 * `FileAssetsModule` is re-exported because a feature that uploads also
 * withdraws, publishes into its own rows and asks the registry questions;
 * needing two imports to do one feature's uploads would be an invitation to
 * import only the first.
 */
@Module({
  imports: [FileAssetsModule, FileScanningModule, SharedModule],
  providers: [AssetIngressService, ImageIngressService],
  exports: [AssetIngressService, ImageIngressService, FileAssetsModule],
})
export class AssetIngressModule {}
